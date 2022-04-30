const asyncRetry = require('async/retry');
const {createChainAddress} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getChannelBalance} = require('ln-service');
const {getChannels} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {openChannel} = require('ln-service');
const {pay} = require('ln-service');
const {sendToChainAddress} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const requestSwapOut = require('./../../swaps/request_swap_out');
const respondToSwapOut = require('./../../swaps/respond_to_swap_out_request');

const capacity = 1e6;
const count = 50;
const interval = 100;
const maturity = 100;
const size = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 3000;
const tokens = 1e5;

// Start an offchain swap but use the claim path to sweep
test(`Swap with claim path`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [{generate, id, lnd}, target] = nodes;

  const {keys} = await getMasterPublicKeys({lnd});

  // Exit early when taproot is not supported
  if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
    await kill({});

    return end();
  }

  try {
    await generate({count: maturity});

    // Setup a channel between the nodes
    {
      // Make a channel
      await asyncRetry({interval, times}, async () => {
        await openChannel({
          lnd,
          local_tokens: capacity,
          partner_public_key: target.id,
          partner_socket: target.socket,
        });
      });

      await asyncRetry({interval, times}, async () => {
        const {channels} = await getChannels({lnd, is_actve: true});

        if (!!channels.length) {
          return channels;
        }

        await generate({});

        await sendToChainAddress({
          lnd,
          address: (await createChainAddress({lnd: target.lnd})).address,
          tokens: capacity,
        });

        const balance = await getChannelBalance({lnd});

        if (!balance.channel_balance) {
          throw new Error('WaitingForChannelBalance');
        }

        throw new Error('WaitingForChannelOpen');
      });

      await target.generate({count: maturity});
    }

    // Collect request messages
    const messages = [];

    // Make a swap out request
    await requestSwapOut({
      lnd,
      ask: async (args, cbk) => {
        if (args.name === 'tokens') {
          return cbk({tokens: '10000'});
        }

        if (args.name === 'rate') {
          return cbk({rate: '10'});
        }

        const swapRequest = messages.find(n => !!n.swap_request);

        if (args.name === 'response') {
          return await respondToSwapOut({
            ask: (args, cbk) => {
              if (args.default) {
                return cbk({[args.name]: args.default});
              }

              if (args.name === 'req') {
                return cbk({req: swapRequest.swap_request});
              }

              throw new Error('UnrecognizedQueryForResponse');
            },
            lnd: target.lnd,
            logger: {
              info: async message => {
                if (!!message.response) {
                  return cbk({response: message.response});
                }

                // Transaction is funded, generate funding into a block
                if (!!message.funding_transaction_id) {
                  return await target.generate({count});
                }
              },
            },
          });
        }

        if (args.name === 'ok') {
          return cbk({ok: true});
        }

        throw new Error('UnrecognizedQueryForRequest');
      },
      is_uncooperative: true,
      logger: {
        info: async message => {
          if (message.broadcasting_tx_to_resolve_swap) {
            await generate({count});
          }

          return messages.push(message);
        },
      },
    });
  } catch (err) {
    strictSame(err, null, 'Expected no failure');
  }

  await kill({});

  return end();
});