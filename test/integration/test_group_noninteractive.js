const {once} = require('events');

const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {createChainAddress} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {sendToChainAddress} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');

const {createGroupChannel} = require('./../../');
const {joinGroupChannel} = require('./../../');

const capacity = 1e5;
const count = 101;
const feeRate = 1;
const interval = 10;
const size = 2;
const tokens = 1e6;
const times = 2000;

// Make a joint transaction channel group non-interactively
test(`Setup joint channel group`, async ({end, equal, strictSame}) => {
  const {kill, nodes} = await spawnLightningCluster({size});

  const [control, target] = nodes;

  const {generate, lnd} = control;

  try {
    // Setup the cluster of nodes to have funds and be connected

    // Make some funds for control
    await generate({count});

    // Get the bitcoinjs network
    const network = networks[(await getNetwork({lnd})).bitcoinjs];

    // Create a target chain address
    const targetAddress = await createChainAddress({lnd: target.lnd});

    // Send coins to target
    await sendToChainAddress({lnd, tokens, address: targetAddress.address});

    // Wait for funds to arrive
    await asyncRetry({interval, times}, async () => {
      await generate({});

      const {transactions} = await getChainTransactions({lnd});

      if (!!transactions.filter(n => !n.is_confirmed).length) {
        throw new Error('TransactionsAreUnconfirmed');
      }
    });

    // Wait for UTXOs to be confirmed
    await asyncRetry({interval, times}, async () => {
      const targetUtxos = await getUtxos({lnd: target.lnd});

      if (!targetUtxos.utxos.filter(n => !!n.confirmation_count).length) {
        throw new Error('ExpectedConfirmedUtxoOnTarget');
      }
    });

    // Connect control to target
    await addPeer({lnd, public_key: target.id, socket: target.socket});

    // Start Group Coordination
    const createLog = [];

    const group = await asyncAuto({
      // Create the group
      create: async () => {
        return await createGroupChannel({
          capacity,
          count: nodes.length,
          lnd: control.lnd,
          logger: {info: line => createLog.push(line)},
          members: [],
          rate: feeRate,
        });
      },

      // Join the group
      join: async () => {
        return await asyncRetry({interval, times}, async () => {
          const code = createLog.find(n => !!n.group_invite_code);

          if (!code) {
            throw new Error('ExpectedGroupChannelJoinCode');
          }

          return await joinGroupChannel({
            code: code.group_invite_code,
            lnd: target.lnd,
            logger: {info: () => {}},
            max_rate: feeRate,
          });
        });
      },
    });

    const ids = [group.join.transaction_id, group.create.transaction_id];

    // Finished, wait for the channels to activate
    await generate({count});

    const {getPendingChannels} = require('ln-service');

    await asyncRetry({interval, times}, async () => {
      await generate({});

      const {channels} = await getChannels({lnd, is_active: true});

      if (!channels.length) {
        throw new Error('ExpectedChannelActivation');
      }
    });

    strictSame(ids.length, nodes.length, 'Got tx ids');
  } catch (err) {
    strictSame(err, null, 'Expected no failure');
  } finally {
    await kill({});
  }

  return end();
});
