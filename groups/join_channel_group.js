const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {decodePsbt} = require('psbt');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');

const {confirmIncomingChannel} = require('./funding');
const {findGroupPartners} = require('./p2p');
const {peerWithPartners} = require('./p2p');
const {proposeGroupChannel} = require('./funding');
const {registerGroupConnected} = require('./p2p');
const {registerPendingOpen} = require('./p2p');
const {registerSignedOpen} = require('./p2p');

const {fromHex} = Transaction;
const interval = 1000;
const times = 60 * 10;

/** Join a channel group

  {
    capacity: <Channel Capacity Tokens Number>
    coordinator: <Channel Group Coordinator Public Key Hex String>
    count: <Group Members Number>
    id: <Group Id Hex String>
    lnd: <Authenticated LND API Object>
    rate: <Chain Fee Tokens Per VByte Number>
  }

  @returns
  <EventEmitter Object>

  @event 'end'
  {
    id: <Transaction Id Hex String>
  }

  @event 'peering'
  {
    inbound: <Inbound Peer Public Key Identity Hex String>
    outbound: <Outbound Peer Public Key Identity Hex String>
  }

  // Sending the signatures for the open to the coordinator
  @event 'publishing'
  {}
*/
module.exports = ({capacity, coordinator, count, id, lnd, rate}, cbk) => {
  const emitter = new EventEmitter();

  asyncAuto({
    // Import ECPair library
    ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

    // Check arguments
    validate: cbk => {
      if (!capacity) {
        return cbk([400, 'ExpectedGroupChannelCapacityToJoinGroup']);
      }

      if (!coordinator) {
        return cbk([400, 'ExpectedChannelCoordinatorIdToJoinGroup']);
      }

      if (!count) {
        return cbk([400, 'ExpectedMembersCountToJoinChannelGroup']);
      }

      if (!id) {
        return cbk([400, 'ExpectedGroupIdToJoinChannelGroup']);
      }

      if (!lnd) {
        return cbk([400, 'ExpectedAuthenticatedLndToJoinChannelGroup']);
      }

      if (!rate) {
        return cbk([400, 'ExpectedChainFeeRateToJoinChannelGroup']);
      }

      return cbk();
    },

    // Find partners in the group
    partners: ['validate', ({}, cbk) => {
      return findGroupPartners({coordinator, id, lnd}, cbk);
    }],

    // Peer with the group partners
    peer: ['partners', ({partners}, cbk) => {
      // Let listeners know that peering will be happening
      emitter.emit('peering', {
        inbound: partners.inbound,
        outbound: partners.outbound,
      });

      return peerWithPartners({
        lnd,
        inbound: partners.inbound,
        outbound: partners.outbound,
      },
      cbk);
    }],

    // Confirm connected the partners
    connected: ['peer', ({}, cbk) => {
      return registerGroupConnected({coordinator, count, id, lnd}, cbk);
    }],

    // Propose to the outgoing partner
    propose: ['connected', 'partners', ({partners}, cbk) => {
      return proposeGroupChannel({
        capacity,
        lnd,
        rate,
        to: partners.outbound,
      },
      cbk);
    }],

    // Register pending proposal and sign and fund
    register: ['propose', ({propose}, cbk) => {
      return registerPendingOpen({
        capacity,
        coordinator,
        lnd,
        change: propose.change,
        funding: propose.funding,
        group: id,
        overflow: propose.overflow,
        pending: propose.id,
        utxos: propose.utxos,
      },
      cbk);
    }],

    // Decode the unsigned PSBT
    transaction: ['ecp', 'register', ({ecp, register}, cbk) => {
      const psbt = decodePsbt({ecp, psbt: register.psbt});

      return cbk(null, {id: fromHex(psbt.unsigned_transaction).getId()});
    }],

    // Confirm the incoming channel
    incoming: [
      'ecp',
      'partners',
      'register',
      'transaction',
      ({ecp, partners, register, transaction}, cbk) =>
    {
      // Make sure that there is an inbound channel
      return asyncRetry({interval, times}, cbk => {
        return confirmIncomingChannel({
          capacity,
          lnd,
          from: partners.inbound,
          id: transaction.id,
          to: partners.outbound,
        },
        cbk);
      },
      cbk);
    }],

    // Publish partial signatures to coordinator
    reveal: ['incoming', 'register', ({register}, cbk) => {
      // Let listeners know that the signature will be sent to coordinator
      emitter.emit('publishing', {signed: register.psbt});

      return registerSignedOpen({
        coordinator,
        count,
        lnd,
        group: id,
        signed: register.psbt,
      },
      cbk);
    }],
  },
  (err, res) => {
    if (!!err) {
      return emitter.emit('error', err);
    }

    return emitter.emit('end', {id: res.transaction.id});
  });

  return emitter;
};
