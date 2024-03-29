const {addPeer} = require('ln-service');
const {address} = require('bitcoinjs-lib');
const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {closeChannel} = require('ln-service');
const {createChainAddress} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {networks} = require('bitcoinjs-lib');
const {openChannel} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');
const {Transaction} = require('bitcoinjs-lib');

const {changeChannelCapacity} = require('./../../capacity');
const {getCapacityChangeRequests} = require('./../../capacity');

const bufferAsHex = buffer => buffer.toString('hex');
const capacity = 1e6;
const {fromHex} = Transaction;
const id = Buffer.alloc(32).toString('hex');
const interval = 10;
const log = () => {};
const maturity = 100;
const size = 3;
const slow = 5000;
const times = 2000;
const {toOutputScript} = address;
const weightAsVBytes = n => Math.ceil(n / 4);

// A capacity movement proposal should be counter signed and accepted
test(`Move channel capacity`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [control, target, remote] = nodes;

  const {generate, lnd} = control;

  const network = networks[(await getNetwork({lnd})).bitcoinjs];

  // Make some funds
  await generate({count: maturity});

  try {
    // Connect remote and target
    await addPeer({
      lnd: target.lnd,
      public_key: remote.id,
      socket: remote.socket,
    });

    // Open up a new channel
    const channelOpen = await openChannel({
      lnd,
      is_private: true,
      local_tokens: capacity,
      partner_public_key: target.id,
      partner_socket: target.socket,
    });

    // Wait for the channel to be active
    const channel = await asyncRetry({interval, times}, async () => {
      const [channel] = (await getChannels({lnd, is_active: true})).channels;

      if (!channel) {
        await generate({});

        throw new Error('ExpectedChannelActivation');
      }

      const {policies} = await getChannel({lnd, id: channel.id});

      const noPolicy = policies.find(n => !n.cltv_delta);

      if (!!channel && !noPolicy) {
        return channel;
      }

      await generate({});

      throw new Error('ExpectedChannelActivation');
    });

    await asyncAuto({
      // Propose the channel
      propose: async () => {
        await changeChannelCapacity({
          lnd,
          ask: (args, cbk) => {
            if (args.name === 'amount') {
              return cbk({amount: '0'});
            }

            if (args.name === 'decrease') {
              return cbk({decrease: 'internal_spend_funds'});
            }

            if (args.name === 'direction') {
              return cbk({direction: 'migrate'});
            }

            if (args.name === 'ok') {
              return cbk({ok: true});
            }

            if (args.name === 'migration') {
              return cbk({migration: 0});
            }

            if (args.name === 'proceed') {
              return cbk({proceed: true});
            }

            if (args.name === 'query') {
              return cbk({query: target.id});
            }

            if (args.name === 'type') {
              return cbk({type: args.default});
            }

            throw new Error('UnknownQueryNameForInitiator');
          },
          logger: {error: log, info: log},
          nodes: [{
            from: 'from',
            lnd: remote.lnd,
            public_key: remote.id,
          }],
        });
      },

      // Wait to see the inbound proposal
      waitForProposal: async () => {
        await asyncRetry({interval, times}, async () => {
          const {requests} = await getCapacityChangeRequests({
            lnd: target.lnd,
          });

          if (!requests.length) {
            throw new Error('FailedToFindChangeRequest');
          }
        });
      },

      // Accept the channel
      accept: ['waitForProposal', async ({}) => {
        await changeChannelCapacity({
          ask: (args, cbk) => {
            if (args.name === 'accept') {
              return cbk({accept: true});
            }

            if (args.name === 'ok') {
              return cbk({ok: true});
            }

            throw new Error('UnexpectedQueryForAcceptingPeer');
          },
          lnd: target.lnd,
          logger: {error: log, info: log},
          nodes: [],
        });
      }],

      // Generate to confirm the change
      generate: ['waitForProposal', async ({}) => {
        // Wait for the new channel to be active
        const recreated = await asyncRetry({
          times,
          interval: slow,
        },
        async () => {
          const {channels} = await getChannels({
            lnd: target.lnd,
            is_active: true,
          });

          const [channel] = channels.filter(n => n.capacity < capacity);

          await generate({});

          if (!channel) {
            throw new Error('ExpectedChannelActivation');
          }

          equal(channel.partner_public_key, remote.id, 'Channel is moved');

          {
            const {policies} = await getChannel({
              lnd: remote.lnd,
              id: channel.id,
            });

            const noPolicy = policies.find(n => !n.cltv_delta);

            if (!!noPolicy) {
              throw new Error('ExpectedChannelPolicy');
            }
          }

          {
            const {policies} = await getChannel({
              id: channel.id,
              lnd: target.lnd,
            });

            const noPolicy = policies.find(n => !n.cltv_delta);

            if (!!noPolicy) {
              throw new Error('ExpectedChannelPolicy');
            }
          }

          return;
        });
      }],
    });
  } catch (err) {
    strictSame(err, null, 'Expected no failure');
  } finally {
    await kill({});
  }

  return end();
});
