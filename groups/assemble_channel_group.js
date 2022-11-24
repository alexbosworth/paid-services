const EventEmitter = require('events');

const asyncRetry = require('async/retry');
const {broadcastChainTransaction} = require('ln-service');
const {combinePsbts} = require('psbt');
const {decodePsbt} = require('psbt');
const {extractTransaction} = require('psbt');
const {finalizePsbt} = require('psbt');
const {Transaction} = require('bitcoinjs-lib');

const {confirmIncomingChannel} = require('./funding');
const {coordinateGroup} = require('./assemble');
const {peerWithPartners} = require('./p2p');
const {proposeGroupChannel} = require('./funding');
const {signAndFundGroupChannel} = require('./funding');

const {fromHex} = Transaction;
const interval = 500;
const minGroupCount = 2;
const times = 2 * 60 * 10;

/** Assemble a channel group

  {
    capacity: <Channel Capacity Tokens Number>
    count: <Channel Members Count Number>
    ecp: <ECPair Library Object>
    identity: <Coordinator Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    [members]: [<Member Identity Public Key Hex String>]
    rate: <Chain Fee Tokens Per VByte Number>
  }

  @returns
  {
    events: <EventEmitter Object>
    id: <Group Id Hex String>
  }

  // Open was published
  @event 'broadcast'
  {
    id: <Transaction Id Hex String>
    transaction: <Transaction Hex String>
  }

  // Open is publishing
  @event 'broadcasting'
  {
    id: <Transaction Id Hex String>
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

  // Members proposed channels to each other
  @event 'proposed'
  {}

  // Members have all signed
  @event 'signed'
  {}
*/
module.exports = ({capacity, count, ecp, identity, lnd, members, rate}) => {
  if (count < minGroupCount) {
    throw new Error('ExpectedHigherGroupCountToAssembleChannelGroup');
  }

  const coordinator = coordinateGroup({
    capacity,
    count,
    identity,
    lnd,
    members,
    rate,
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

    // Exit early when this is a pair group
    if (count === minGroupCount) {
      return coordinator.connected();
    }

    const {inbound, outbound} = coordinator.partners(identity);

    // Connect to the inbound and outbound partners
    try {
      await peerWithPartners({inbound, lnd, outbound});

      // Register as connected
      return coordinator.connected();
    } catch (err) {
      return errored(err);
    }
  });

  // Group members have connected to each other
  coordinator.events.once('connected', async () => {
    emitter.emit('connected', {});

    try {
      // Fund and propose the pending channel to the outbound partner
      const {change, funding, id, utxos} = await proposeGroupChannel({
        capacity,
        count,
        lnd,
        rate,
        to: coordinator.partners(identity).outbound,
      });

      pending.id = id;
      pending.utxos = utxos;

      // Register as proposed
      return coordinator.proposed({change, funding, utxos, id: identity});
    } catch (err) {
      return errored(err);
    }
  });

  // Group members have proposed channels to each other
  coordinator.events.once('funded', async () => {
    emitter.emit('proposed', {unsigned: coordinator.unsigned()});

    try {
      const basePsbt = decodePsbt({ecp, psbt: coordinator.unsigned()});

      // Sign the unsigned funding transaction
      const signed = await signAndFundGroupChannel({
        lnd,
        id: pending.id,
        psbt: coordinator.unsigned(),
        utxos: pending.utxos,
      });

      // Make sure there is an incoming channel
      await asyncRetry({interval, times}, async () => {
        return await confirmIncomingChannel({
          capacity,
          lnd,
          from: coordinator.partners(identity).inbound,
          id: fromHex(basePsbt.unsigned_transaction).getId(),
          to: coordinator.partners(identity).outbound || undefined,
        });
      });

      // Register the signature with the coordinator
      return coordinator.sign({id: identity, signed: signed.psbt});
    } catch (err) {
      return errored(err);
    }
  });

  // Group members have submitted their partial signatures
  coordinator.events.once('signed', async () => {
    // Collect all the partially signed PSBTs
    const psbts = coordinator.signed().map(n => n.signed);

    emitter.emit('signed', {psbts});

    try {
      // Merge partial PSBTs into a single PSBT
      const combined = combinePsbts({ecp, psbts});

      // Finalize the PSBT to convert partial signatures to final signatures
      const finalized = finalizePsbt({ecp, psbt: combined.psbt});

      // Pull out the raw transaction from the PSBT
      const {transaction} = extractTransaction({ecp, psbt: finalized.psbt});

      emitter.emit('broadcasting', ({transaction}));

      const {id} = await broadcastChainTransaction({lnd, transaction});

      return emitter.emit('broadcast', {id, transaction});
    } catch (err) {
      return errored(err);
    }
  });

  return {events: emitter, id: coordinator.id};
};
