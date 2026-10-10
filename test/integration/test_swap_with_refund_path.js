const {deepStrictEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const {rejects} = require('node:assert').strict;
const test = require('node:test');

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

const requestSwapOut = require('./../../swaps/request_swap_out');
const respondToSwapOut = require('./../../swaps/respond_to_swap_out_request');

const capacity = 1e6;
const count = 50;
const delay = ms => new Promise(done => setTimeout(done, ms).unref());
const interval = 100;
const isRejected = err => err[1] === 'PaymentRejectedByDestination';
const maturity = 100;
const settleMs = 1000 * 60;
const size = 2;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 3000;
const tokens = 1e5;
const waitTimes = 600;

// Start an offchain swap but do not cooperate and eventually force a refund
test(`Timeout a swap`, async () => {
  const {kill, nodes} = await spawnLightningCluster({size});

  // Swap callbacks keep running in the background, like the responder that
  // finishes its side of the swap, so their failures are collected and they
  // get a chance to finish before the nodes that they use are killed
  const background = [];
  const failures = [];

  const track = method => (...args) => {
    return background.push(method(...args).catch(err => failures.push(err)));
  };

  try {
    const [{generate, lnd}, target] = nodes;

    const {keys} = await getMasterPublicKeys({lnd});

    // Collect response messages
    const responder = [];

    // Exit early when taproot is not supported
    if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
      return;
    }

    await generate({count: maturity});

    // Setup a channel between the nodes
    {
      // Make a channel
      await asyncRetry({interval, times}, async () => {
        await generate({});

        await openChannel({
          lnd,
          local_tokens: capacity,
          partner_public_key: target.id,
          partner_socket: target.socket,
        });
      });

      await asyncRetry({interval, times}, async () => {
        const {channels} = await getChannels({lnd, is_active: true});

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

    // Make sure control can pay off chain to target
    {
      await asyncRetry({interval, times}, async () => {
        await generate({});

        return await pay({
          lnd,
          request: (await createInvoice({tokens, lnd: target.lnd})).request,
        });
      });
    }

    // Collect request messages
    const messages = [];

    // Collect responder failures
    const responseErrors = [];

    // Make an uncooperative swap out request that ends in a refund
    const swap = requestSwapOut({
      lnd,
      ask: track(async (args, cbk) => {
        if (args.name === 'tokens') {
          return cbk({tokens: '10000'});
        }

        if (args.name === 'rate') {
          return cbk({rate: '10'});
        }

        const swapRequest = messages.find(n => !!n.swap_request);

        if (args.name === 'response') {
          try {
            return await respondToSwapOut({
              ask: (args, cbk) => {
                if (args.default) {
                  return cbk({[args.name]: args.default});
                }

                if (args.name === 'incoming') {
                  return cbk({incoming: false});
                }

                if (args.name === 'req') {
                  return cbk({req: swapRequest.swap_request});
                }

                throw new Error('UnrecognizedQueryForResponse');
              },
              lnd: target.lnd,
              logger: {
                info: track(async message => {
                  responder.push(message);

                  // Push chain forward to timeout
                  if (!!message.blocks_until_timeout) {
                    return await target.generate({});
                  }

                  if (!!message.response) {
                    return cbk({response: message.response});
                  }

                  // Transaction is funded, generate funding into a block
                  if (!!message.funding_transaction_id) {
                    return await target.generate({count});
                  }
                }),
              },
            });
          } catch (err) {
            // The responder gives up when the swap is refunded on timeout
            return responseErrors.push(err);
          }
        }

        if (args.name === 'ok') {
          return cbk({ok: true});
        }

        throw new Error('UnrecognizedQueryForRequest');
      }),
      is_avoiding_broadcast: true,
      is_uncooperative: true,
      logger: {
        info: track(async message => {
          if (message.broadcasting_tx_to_resolve_swap) {
            await generate({count});
          }

          return messages.push(message);
        }),
      },
    });

    await rejects(swap, isRejected, 'Swap payment is rejected by responder');

    // Keep this wait well within the runner timeout to surface a clear failure
    await asyncRetry({interval, times: waitTimes}, async () => {
      if (!responseErrors.length) {
        throw new Error('WaitingForResponderToFinish');
      }
    });

    const timeout = [503, 'SwapFailedViaTimeout'];

    deepStrictEqual(responseErrors, [timeout], 'Responder swap timed out');

    const complete = responder.find(n => !!n.swap_timeout_complete);

    equal(!!complete, true, 'Swap refund completed');

    // Background work like the responder finishing its side must not fail
    await Promise.race([Promise.all(background), delay(settleMs)]);

    deepStrictEqual(failures, [], 'No failures in swap callbacks');
  } finally {
    // Give background work a chance to finish before its nodes go away
    await Promise.race([Promise.all(background), delay(settleMs)]);

    await kill({});
  }
});
