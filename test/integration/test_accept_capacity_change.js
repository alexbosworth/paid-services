const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {closeChannel} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {openChannel} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');
const {Transaction} = require('bitcoinjs-lib');

const accept = require('./../../capacity/accept_capacity_change');
const finalize = require('./../../capacity/finalize_capacity_replacement');
const method = require('./../../capacity/sign_capacity_replacement');
const propose = require('./../../capacity/propose_capacity_change');
const {servicePeerRequests} = require('./../../');

const acceptCapacityChange = accept;
const bufferAsHex = buffer => buffer.toString('hex');
const capacity = 1e6;
const finalizeCapacityReplacement = finalize;
const {fromHex} = Transaction;
const id = Buffer.alloc(32).toString('hex');
const interval = 10;
const logger = {error: () => {}, info: () => {}};
const maturity = 100;
const proposeCapacityChange = propose;
const signCapacityReplacement = method;
const size = 2;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const times = 2000;
const {toOutputScript} = address;
const weightAsVBytes = n => Math.ceil(n / 4);

// A capacity replacement proposal should be counter signed and accepted
test(`Accept capacity replacement`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [control, target] = nodes;

  const {generate, lnd} = control;

  const network = networks[(await getNetwork({lnd})).bitcoinjs];

  // Make some funds
  await generate({count: maturity});

  try {
    // Open up a new channel
    const channelOpen = await openChannel({
      lnd,
      local_tokens: capacity,
      partner_public_key: target.id,
      partner_socket: target.socket,
    });

    // Wait for the channel to be active
    const channel = await asyncRetry({interval, times}, async () => {
      const [channel] = (await getChannels({lnd, is_active: true})).channels;

      if (!!channel) {
        return channel;
      }

      await generate({});

      throw new Error('ExpectedChannelActivation');
    });

    // Find the open tx
    const tx = (await getChainTransactions({lnd})).transactions.find(tx => {
      return tx.id === channel.transaction_id;
    });

    // Get the open tx output
    const output = fromHex(tx.transaction).outs[channel.transaction_vout];

    const baseFee = channel.commit_transaction_fee;
    const deltaFee = weightAsVBytes(channel.commit_transaction_weight);

    const openTxHash = fromHex(tx.transaction).getHash();

    // Setup service to ack the accept
    const service = servicePeerRequests({lnd});
    const type = '8050002';

    // Listen for the acceptance of the capacity change
    service.request({type}, (req, res) => {
      service.stop({});

      return res.success({records: [{type: '1', value: tx.transaction}]});
    });

    await asyncAuto({
      // Propose the channel
      propose: async () => {
        await proposeCapacityChange({
          id,
          lnd,
          logger,
          bitcoinjs_network: (await getNetwork({lnd})).bitcoinjs,
          channel: channel.id,
          decrease: [],
          open_transaction: tx.transaction,
          partner_public_key: target.id,
          transaction_id: channel.transaction_id,
          transaction_vout: channel.transaction_vout,
        });

        proposeDone = true;

        return;
      },

      accept: async () => {
        await acceptCapacityChange({
          id,
          logger,
          channel: channel.id,
          from: control.id,
          lnd: target.lnd,
        });
      },

      confirmTarget: ['accept', async ({}) => {
        // Wait for the new channel to be active
        const recreated = await asyncRetry({interval, times}, async () => {
          const controlChannels = (await getChannels({lnd, is_active: true}));

          const [channel] = controlChannels.channels;

          const targetChans = await getChannels({
            is_active: true,
            lnd: target.lnd,
          });

          const targetChan = targetChans.channels;

          if (!!channel && !!targetChan && channel.capacity < capacity) {
            return channel;
          }

          await generate({});

          throw new Error('ExpectedChannelActivation');
        });

        strictSame(recreated.is_active, true, 'Recreated channel is active');
      }],

      confirmControl: ['accept', 'propose', async ({}) => {
        // Wait for the new channel to be active
        const recreated = await asyncRetry({interval, times}, async () => {
          const controlChannels = (await getChannels({lnd, is_active: true}));

          const [channel] = controlChannels.channels;

          const targetChans = await getChannels({
            is_active: true,
            lnd: target.lnd,
          });

          const targetChan = targetChans.channels;

          if (!!channel && !!targetChan && channel.capacity < capacity) {
            return channel;
          }

          await generate({});

          throw new Error('ExpectedChannelActivation');
        });

        strictSame(recreated.is_active, true, 'Recreated channel is active');
      }],
    });
  } catch (err) {
    strictSame(err, null, 'Expected no failure');
  } finally {
    await kill({});
  }

  return end();
});
