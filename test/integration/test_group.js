const {once} = require('events');

const {addPeer} = require('ln-service');
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
const tinysecp = require('tiny-secp256k1');

const assembleChannelGroup = require('./../../groups/assemble_channel_group');
const {confirmIncomingChannel} = require('./../../groups/funding');
const {getGroupDetails} = require('./../../groups/p2p');
const joinChannelGroup = require('./../../groups/join_channel_group');

const capacity = 1e5;
const count = 101;
const feeRate = 1;
const interval = 10;
const size = 3;
const tokens = 1e6;
const times = 2000;

// Make a joint transaction channel group
test(`Setup joint channel group`, async ({end, equal, strictSame}) => {
  const ecp = (await import('ecpair')).ECPairFactory(tinysecp);
  const {kill, nodes} = await spawnLightningCluster({size});

  const [control, target, remote] = nodes;

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

    // Create a remote chain address
    const remoteAddress = await createChainAddress({
      format: 'p2tr',
      lnd: remote.lnd,
    });

    // Send coins to remote
    await sendToChainAddress({lnd, tokens, address: remoteAddress.address});

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
      const remoteUtxos = await getUtxos({lnd: remote.lnd});
      const targetUtxos = await getUtxos({lnd: target.lnd});

      if (!targetUtxos.utxos.filter(n => !!n.confirmation_count).length) {
        throw new Error('ExpectedConfirmedUtxoOnTarget');
      }

      if (!remoteUtxos.utxos.filter(n => !!n.confirmation_count).length) {
        throw new Error('ExpectedConfirmUtxoOnRemote');
      }
    });

    // Connect control to target
    await addPeer({lnd, public_key: target.id, socket: target.socket});

    // Connect target to remote
    await addPeer({
      lnd: target.lnd,
      public_key: remote.id,
      socket: remote.socket,
    });

    // Connect remote to control
    await addPeer({
      lnd: remote.lnd,
      public_key: control.id,
      socket: control.socket,
    });

    // Start Group Coordination

    // Start the coordination
    const assemble = assembleChannelGroup({
      capacity,
      ecp,
      count: nodes.length,
      identity: control.id,
      lnd: control.lnd,
      rate: feeRate,
    });

    const events = {};

    assemble.events.once('broadcast', n => events.broadcast = n);
    assemble.events.once('filled', n => events.filled = n);

    // Target and remote join the group
    const joins = await asyncMap([target.lnd, remote.lnd], async lnd => {
      const group = await getGroupDetails({
        lnd,
        coordinator: control.id,
        id: assemble.id,
      });

      const join = joinChannelGroup({
        lnd,
        capacity: group.capacity,
        coordinator: control.id,
        count: group.count,
        id: assemble.id,
        rate: group.rate,
      });

      const [{inbound, outbound}] = await once(join, 'peering');

      strictSame(!!inbound, true, 'Received inbound peer');
      strictSame(!!outbound, true, 'Received outbound peer');

      const [tx] = await once(join, 'end');

      return tx;
    });

    // Transaction ids of the open should be returned
    const ids = joins.map(n => n.id);

    // Finished, wait for the channels to activate
    await generate({count});

    await asyncRetry({interval, times}, async () => {
      const {channels} = await getChannels({lnd, is_active: true});

      if (!channels.length) {
        throw new Error('ExpectedChannelActivation');
      }
    });

    strictSame(ids, [events.broadcast.id, events.broadcast.id], 'Got tx ids');
    strictSame(events.broadcast.id.length, 64, 'Got broadcast tx id');
    strictSame(!!events.broadcast.transaction, true, 'Got broadcast tx');
    strictSame(events.filled.ids.length, nodes.length, 'Got filled event');
  } catch (err) {
    strictSame(err, null, 'Expected no failure');
  } finally {
    await kill({});
  }

  return end();
});
