const EventEmitter = require('events');

const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {combinePsbts} = require('psbt');
const {decodePsbt} = require('psbt');
const {extractTransaction} = require('psbt');
const {finalizePsbt} = require('psbt');
const {Transaction} = require('bitcoinjs-lib');

const coordinateFanout = require('./coordinate_fanout');
const {peerWithPartners} = require('./../groups/p2p');
const proposeFanout = require('./propose_fanout');
const {signAndFundGroupChannel} = require('../groups/funding');

const {fromHex} = Transaction;
const interval = 500;
const minGroupCount = 3;
const times = 2 * 60 * 10;

/** Assemble a fanout group

  {
    capacity: <Output Capacity Tokens Number>
    count: <Channel Members Count Number>
    ecp: <ECPair Library Object>
    identity: <Coordinator Identity Public Key Hex String>
    inputs: [<Utxo Outpoint String>]
    lnd: <Authenticated LND API Object>
    [members]: [<Member Identity Public Key Hex String>]
    output_count: <Output Count Number>
    rate: <Chain Fee Tokens Per VByte Number>
  }

  @returns
  {
    events: <EventEmitter Object>
    id: <Group Id Hex String>
  }

  // Fanout was published
  @event 'broadcast'
  {
    id: <Transaction Id Hex String>
    transaction: <Transaction Hex String>
  }

  // Fanout is publishing
  @event 'broadcasting'
  {
    transaction: <Transaction Hex String>
  }

  // Members are peered
  @event 'connected'
  {}

  // All members are present
  @event 'filled'
  {
    ids: [<Group Member Identity Public Key Hex String>]
  }

  // Member is present
  @event 'present'
  {
    id: <Present Member Public Id Hex String>
  }

  // Members proposed channels to each other
  @event 'proposed'
  {}

  // Members have all signed
  @event 'signed'
  {}
*/
module.exports = (args) => {
  if (args.count < minGroupCount) {
    throw new Error('ExpectedHigherGroupCountToAssembleFanoutGroup');
  }

  const coordinator = coordinateFanout({
    capacity: args.capacity,
    count: args.count,
    identity: args.identity,
    lnd: args.lnd,
    members: args.members,
    rate: args.rate,
  });

  const emitter = new EventEmitter();
  const pending = {};

  const errored = err => {
    coordinator.events.removeAllListeners();

    return emitter.emit('error', err);
  };

  // An error was encountered
  coordinator.events.once('error', errored);

  // Group members have registered themselves
  coordinator.events.once('joined', async ({ids}) => {
    emitter.emit('filled', {ids});
  });

  // Group members have connected to each other
  coordinator.events.once('connected', async () => {
    emitter.emit('connected', {});

    try {
      // Fund and propose the pending fanout
      const {change, funding, utxos} = await proposeFanout({
        capacity: args.capacity,
        count: args.count,
        inputs: args.inputs,
        lnd: args.lnd,
        output_count: args.output_count,
        rate: args.rate,
      });

      pending.utxos = utxos;

      // Register as proposed
      return coordinator.proposed({change, funding, utxos, id: args.identity});
    } catch (err) {
      return errored(err);
    }
  });

  // Group members have proposed channels to each other
  coordinator.events.once('funded', async () => {
    emitter.emit('proposed', {unsigned: coordinator.unsigned()});

    try {
      const basePsbt = decodePsbt({ecp: args.ecp, psbt: coordinator.unsigned()});

      // Sign the unsigned funding transaction
      const signed = await signAndFundGroupChannel({
        lnd: args.lnd,
        psbt: coordinator.unsigned(),
        utxos: pending.utxos,
      });

      // Register the signature with the coordinator
      return coordinator.sign({id: args.identity, signed: signed.psbt});
    } catch (err) {
      return errored(err);
    }
  });

  // Relay presence notifications
  coordinator.events.on('present', ({id}) => emitter.emit('present', {id}));

  // Group members have submitted their partial signatures
  coordinator.events.once('signed', async () => {
    // Collect all the partially signed PSBTs
    const psbts = coordinator.signed().map(n => n.signed);

    emitter.emit('signed', {psbts});

    try {
      // Merge partial PSBTs into a single PSBT
      const combined = combinePsbts({ecp: args.ecp, psbts});

      // Finalize the PSBT to convert partial signatures to final signatures
      const finalized = finalizePsbt({ecp: args.ecp, psbt: combined.psbt});

      // Pull out the raw transaction from the PSBT
      const {transaction} = extractTransaction({ecp: args.ecp, psbt: finalized.psbt});

      emitter.emit('broadcasting', ({transaction}));

      const {id} = await broadcastChainTransaction({transaction, lnd: args.lnd});

      return emitter.emit('broadcast', {id, transaction});
    } catch (err) {
      return errored(err);
    }
  });

  return {events: emitter, id: coordinator.id};
};
