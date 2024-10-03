const EventEmitter = require('events');

const {broadcastChainTransaction} = require('ln-service');
const {combinePsbts} = require('psbt');
const {decodePsbt} = require('psbt');
const {extractTransaction} = require('psbt');
const {finalizePsbt} = require('psbt');
const {signAndFundPsbt} = require('ln-sync');

const coordinateFanout = require('./coordinate_fanout');
const getFanoutFunding = require('./get_fanout_funding');
const transactionFeeRate = require('./../transaction_fee_rate');

/** Assemble a fanout group

  This group type must have at least 3 participants

  {
    capacity: <Output Size Tokens Number>
    count: <Fanout Members Count Number>
    ecp: <ECPair Library Object>
    identity: <Coordinator Identity Public Key Hex String>
    inputs: [<Utxo Outpoint String>]
    lnd: <Authenticated LND API Object>
    [members]: [<Member Identity Public Key Hex String>]
    outputs: <Output Count Number>
    rate: <Chain Fee Tokens Per VByte Number>
  }

  @returns
  {
    events: <Fanout Status Notifications EventEmitter Object>
    id: <Group Identifier Hex Encoded String>
  }

  // The fanout transaction was successfully published to relays
  @event 'broadcast'
  {
    id: <Transaction Id Hex String>
    transaction: <Transaction Hex String>
  }

  // The fanout transaction is being published to relays
  @event 'broadcasting'
  {
    transaction: <Transaction Hex String>
  }

  // A member is peered with the coordinator
  @event 'connected'
  {}

  // All members are peered with the coordinator
  @event 'filled'
  {
    ids: [<Group Member Identity Public Key Hex String>]
  }

  // A member sent a presence update
  @event 'present'
  {
    id: <Present Member Public Id Hex String>
  }

  // Members have proposed the entire unsigned fanout to the coordinator
  @event 'proposed'
  {}

  // Members have all signed the fanout transaction
  @event 'signed'
  {}
*/
module.exports = args => {
  const coordinator = coordinateFanout({
    capacity: args.capacity,
    count: args.count,
    ecp: args.ecp,
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
  coordinator.events.once('joined', ({ids}) => emitter.emit('filled', {ids}));

  // Group members have connected to the coordinator
  coordinator.events.once('connected', async () => {
    emitter.emit('connected', {});

    try {
      // Get the self funding details for the fanout
      const {change, funding, utxos} = await getFanoutFunding({
        capacity: args.capacity,
        inputs: args.inputs,
        lnd: args.lnd,
        outputs: args.outputs,
        rate: args.rate,
      });

      pending.utxos = utxos;

      // Register self as proposed
      return coordinator.proposed({change, funding, utxos, id: args.identity});
    } catch (err) {
      return errored(err);
    }
  });

  // Group members have proposed fanout to the coordinator
  coordinator.events.once('funded', async () => {
    emitter.emit('proposed', {unsigned: coordinator.unsigned()});

    try {
      // Sign the unsigned funding transaction
      const signed = await signAndFundPsbt({
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
    // Collect all the partially signed PSBTs to be combined into a single PSBT
    const psbts = coordinator.signed().map(n => n.signed);

    emitter.emit('signed', {psbts});

    try {
      // Merge all the partial signed PSBTs into a single PSBT with all sigs
      const combined = combinePsbts({psbts, ecp: args.ecp});

      // Finalize the PSBT to convert partial signatures to final signatures
      const finalized = finalizePsbt({ecp: args.ecp, psbt: combined.psbt});

      // Pull out the raw transaction from the PSBT
      const {transaction} = extractTransaction({
        ecp: args.ecp,
        psbt: finalized.psbt,
      });

      const {inputs} = decodePsbt({ecp: args.ecp, psbt: combined.psbt});

      // Make sure the final transaction fee rate is not too low
      if (transactionFeeRate({inputs, transaction}).rate < args.rate) {
        throw [503, 'UnexpectedLowFeeRateForFanoutTransaction'];
      }

      emitter.emit('broadcasting', ({transaction}));

      const {id} = await broadcastChainTransaction({
        transaction,
        lnd: args.lnd,
      });

      return emitter.emit('broadcast', {id, transaction});
    } catch (err) {
      return errored(err);
    }
  });

  return {events: emitter, id: coordinator.id};
};
