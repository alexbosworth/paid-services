const {deepStrictEqual} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createChainAddress} = require('ln-service');
const {createInvoice} = require('ln-service');
const EventEmitter = require('events');
const {getChannelBalance} = require('ln-service');
const {getChannels} = require('ln-service');
const {getMasterPublicKeys} = require('ln-service');
const {openChannel} = require('ln-service');
const {pay} = require('ln-service');
const {sendToChainAddress} = require('ln-service');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');
const {spawnLightningCluster} = require('ln-docker-daemons');

const completeOffToOnSwap = require('./../../swaps/complete_off_to_on_swap');
const respondToSwapOut = require('./../../swaps/respond_to_swap_out_request');
const startOffToOnSwap = require('./../../swaps/start_off_to_on_swap');

const all = promises => Promise.all(promises);
const capacity = 1e6;
const cappedClaimOutput = 1092;
const count = 50;
const delay = ms => new Promise(done => setTimeout(done, ms).unref());
const interval = 100;
const maturity = 100;
const maxFeeDeposit = 1337;
const maxFeeFunding = 0;
const race = promises => Promise.race(promises);
const settleMs = 1000 * 60;
const size = 2;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const swapTokens = 10000;
const taprootDerivationPath = `m/86'/0'/0'`;
const times = 3000;
const tokens = 1e5;

// Completing a swap emits every signed unilateral claim with its fee rate
test(`Complete off to on swap`, async () => {
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

    // Exit early when taproot is not supported
    if (!keys.find(n => n.derivation_path === taprootDerivationPath)) {
      return;
    }

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

    // Make a swap out request
    const {recovery, request} = await startOffToOnSwap({
      lnd,
      tokens: swapTokens,
    });

    // Target responds to the request and keeps going to fund the swap
    const response = await new Promise((resolve, reject) => {
      const responding = respondToSwapOut({
        ask: (args, cbk) => {
          if (args.default) {
            return cbk({[args.name]: args.default});
          }

          if (args.name === 'incoming') {
            return cbk({incoming: false});
          }

          if (args.name === 'req') {
            return cbk({req: request});
          }

          throw new Error('UnrecognizedQueryForResponse');
        },
        lnd: target.lnd,
        logger: {
          info: track(async message => {
            // Make sure that target gets the funding transaction
            if (message.funding_transaction) {
              await broadcastChainTransaction({
                lnd: target.lnd,
                transaction: message.funding_transaction,
              });
            }

            if (!!message.response) {
              return resolve(message.response);
            }

            // Transaction is funded, generate funding into a block
            if (!!message.funding_transaction_id) {
              return await target.generate({count});
            }
          }),
        },
      });

      // A failure to respond means there will be no response
      background.push(responding.catch(err => {
        failures.push(err);

        return reject(err);
      }));
    });

    // Collect the emitted signed claims
    const emitted = [];
    const emitter = new EventEmitter();

    emitter.on('unilateral_claims', ({claims}) => emitted.push(claims));

    emitter.on('update', track(async update => {
      if (update.broadcasting_tx_to_resolve_swap) {
        await generate({count});
      }
    }));

    await completeOffToOnSwap({
      emitter,
      lnd,
      recovery,
      response,
      is_uncooperative: true,
      max_fee_deposit: maxFeeDeposit,
      max_fee_funding: maxFeeFunding,
    });

    // Background work like the responder finishing its side must not fail
    await race([all(background), delay(settleMs)]);

    deepStrictEqual(failures, [], 'No failures in swap callbacks');

    deepStrictEqual(emitted.length, 1, 'Signed claims are emitted once');

    const [claims] = emitted;

    // Work out the fee rate that each signed claim transaction pays
    const paid = claims.map(({transaction}) => {
      const {outputs} = componentsOfTransaction({transaction});
      const {vsize} = sizeOfTransaction({transaction});

      const swept = sumOf(outputs.map(n => n.tokens));

      const fee = swapTokens - swept;

      return {swept, fee_rate: fee / vsize};
    });

    const reported = claims.map(n => n.fee_rate);

    deepStrictEqual(reported, paid.map(n => n.fee_rate), 'Claim fee rates');

    const [last] = paid.slice().reverse();

    // The last claim fee is capped to keep an output, so it pays less than the
    // fee rate it was made for, and the fee rate it pays is the one reported
    deepStrictEqual(last.swept, cappedClaimOutput, 'Last claim fee is capped');
  } finally {
    // Give background work a chance to finish before its nodes go away
    await race([all(background), delay(settleMs)]);

    await kill({});
  }
});
