const {once} = require('events');

const {addPeer} = require('ln-service');
const asyncEach = require('async/each');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {createChainAddress} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {sendToChainAddress} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {test} = require('@alexbosworth/tap');
const tinysecp = require('tiny-secp256k1');

const assembleGroup = require('./../../groups/fanout/assemble_fanout_group');
const getFanoutDetails = require('./../../groups/fanout/get_fanout_details');
const joinFanout = require('./../../groups/fanout/join_fanout');

const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const capacity = 1e5;
const count = 101;
const feeRate = 1;
const format = 'p2tr';
const interval = 10;
const outputCount = 2;
const outputCountControl = 4;
const size = 3;
const tokens = 1e6;
const times = 2000;
const uniq = arr => Array.from(new Set(arr));

// Make a joint transaction fanout group
test(`Setup joint fanout group`, async ({end, equal, strictSame}) => {
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
    const remoteAddress = await createChainAddress({format, lnd: remote.lnd});

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

    // Connect target to control
    await addPeer({
      lnd: target.lnd,
      public_key: control.id,
      socket: control.socket,
    });

    // Connect remote to control
    await addPeer({
      lnd: remote.lnd,
      public_key: control.id,
      socket: control.socket,
    });

    // Get utxos of the coordinator
    const controlUtxos = await getUtxos({lnd: control.lnd});

    const [utxoForControl] = controlUtxos.utxos.map(asOutpoint).reverse();

    // Start the coordination
    const assemble = assembleGroup({
      capacity,
      ecp,
      count: nodes.length,
      identity: control.id,
      inputs: [utxoForControl],
      lnd: control.lnd,
      outputs: outputCountControl,
      rate: feeRate,
    });

    const events = {};

    assemble.events.once('broadcast', n => events.broadcast = n);
    assemble.events.once('filled', n => events.filled = n);

    // Target and remote join the group
    const joins = await asyncMap([target.lnd, remote.lnd], async lnd => {
      const group = await getFanoutDetails({
        lnd,
        coordinator: control.id,
        id: assemble.id,
      });

      const {utxos} = await getUtxos({lnd});

      const join = joinFanout({
        lnd,
        capacity: group.capacity,
        coordinator: control.id,
        count: group.count,
        id: assemble.id,
        inputs: utxos.map(n => asOutpoint(n)),
        output_count: outputCount,
        rate: group.rate,
      });

      const [tx] = await once(join, 'end');

      return tx;
    });

    // Transaction ids of the open should be returned
    const ids = joins.map(n => n.id);

    strictSame(uniq(ids).length, 1, 'Only one transaction id');

    // Finished, wait for confirmations on fanout utxos
    await generate({count});

    const expected = [
      {
        lnd: control.lnd,
        count: outputCountControl,
      },
      {
        lnd: target.lnd,
        count: outputCount,
      },
      {
        lnd: remote.lnd,
        count: outputCount,
      },
    ];

    // Check if the expected utxos are confirmed
    await asyncRetry({interval, times}, async () => {
      await asyncEach(expected, async ({count, lnd}) => {
        const [txId] = ids;
        const {utxos} = await getUtxos({lnd, min_confirmations: 1});

        const utxosCount = utxos
          .filter(n => n.transaction_id === txId)
          .filter(n => n.tokens === capacity)
          .length;

        strictSame(utxosCount, count, 'Got expected UTXOs count');
      });
    });

    const components = componentsOfTransaction({
      transaction: events.broadcast.transaction,
    });

    const controlExtra = components.outputs.find(n => n.tokens === 4999599712);
    const fundedOuts = components.outputs.filter(n => n.tokens === capacity);

    const changeOutput1 = components.outputs
      .find(n => n.tokens === 799798 || n.tokens === 799799);

    const changeOutput2 = components.outputs
      .find(n => n.tokens === 799809 || n.tokens === 799810);

    strictSame(components.inputs.length, 3, 'Got expected inputs count');
    strictSame(components.outputs.length, 11, 'Got expected outputs count');
    strictSame(fundedOuts.length, 8, 'Got expected funded outputs count');
    strictSame(!!changeOutput1, true, 'Got change output 1');
    strictSame(!!changeOutput2, true, 'Got change output 2');
    strictSame(!!controlExtra, true, 'Got control change output');
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
