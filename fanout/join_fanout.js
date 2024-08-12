const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const {decodePsbt} = require('psbt');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');

const {findGroupPartners} = require('./../groups/p2p');
const {peerWithPartners} = require('./../groups/p2p');
const proposeFanout = require('./propose_fanout');
const {registerGroupConnected} = require('./../groups/p2p');
const {registerPendingOpen} = require('./../groups/p2p');
const {registerSignedOpen} = require('./../groups/p2p');
const {serviceTypeFindFanoutPartners} = require('./../service_types')
const {serviceTypeRegisterPendingFanout} = require('./../service_types')
const {serviceTypeRegisterSignedFanout} = require('./../service_types')

const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const interval = 1000;
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const times = 60 * 10;

/** Join a fanout group

  {
    capacity: <Channel Capacity Tokens Number>
    coordinator: <Channel Group Coordinator Public Key Hex String>
    count: <Group Members Number>
    id: <Group Id Hex String>
    [inputs]: [<Utxo Outpoints String>]
    lnd: <Authenticated LND API Object>
    output_count: <Output Count Number>
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
module.exports = (args, cbk) => {
  const emitter = new EventEmitter();

  asyncAuto({
    // Import ECPair library
    ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

    // Check arguments
    validate: cbk => {
      if (!isArray(args.inputs)) {
        return cbk([400, 'ExpectedArrayOfUtxosToJoinFanout']);
      }

      if (!args.capacity) {
        return cbk([400, 'ExpectedGroupChannelCapacityToJoinFanout']);
      }

      if (!args.coordinator) {
        return cbk([400, 'ExpectedChannelCoordinatorIdToJoinFanout']);
      }

      if (!args.count) {
        return cbk([400, 'ExpectedMembersCountToJoinFanout']);
      }

      if (!args.id) {
        return cbk([400, 'ExpectedGroupIdToJoinFanout']);
      }

      if (!args.lnd) {
        return cbk([400, 'ExpectedAuthenticatedLndToJoinFanout']);
      }

      if (!args.output_count || !isNumber(args.output_count)) {
        return cbk([400, 'ExpectedOutputCountToJoinFanout']);
      }

      if (!args.rate) {
        return cbk([400, 'ExpectedChainFeeRateToJoinFanout']);
      }

      return cbk();
    },

    // Find partners in the group
    partners: ['validate', ({}, cbk) => {
      return findGroupPartners({
        coordinator: args.coordinator,
        count: args.count,
        id: args.id,
        lnd: args.lnd,
        service: serviceTypeFindFanoutPartners
      }, cbk);
    }],

    // Peer with the group partners
    peer: ['partners', ({partners}, cbk) => {
      // Exit early when there is no inbound partner to connect with
      if (!partners.inbound) {
        return cbk();
      }

      // Let listeners know that peering will be happening
      emitter.emit('peering', {
        inbound: partners.inbound,
        outbound: partners.outbound,
      });

      return peerWithPartners({
        capacity: args.capacity,
        lnd: args.lnd,
        inbound: partners.inbound,
        outbound: partners.outbound,
        skip_acceptance_check: true,
      },
      cbk);
    }],

    // Confirm connected the partners
    connected: ['peer', ({}, cbk) => {
      return registerGroupConnected({
        coordinator: args.coordinator,
        count: args.count,
        id: args.id,
        lnd: args.lnd,
      }, cbk);
    }],

    // Propose to the outgoing partner
    propose: ['connected', 'partners', ({partners}, cbk) => {
      return proposeFanout({
        capacity: args.capacity,
        count: args.count,
        inputs: args.inputs,
        lnd: args.lnd,
        output_count: args.output_count,
        rate: args.rate,
        to: partners.outbound,
      },
      cbk);
    }],

    // Register pending proposal and sign and fund
    register: ['propose', ({propose}, cbk) => {
      return registerPendingOpen({
        capacity: args.capacity,
        coordinator: args.coordinator,
        change: propose.change,
        funding: propose.funding,
        group: args.id,
        lnd: args.lnd,
        overflow: propose.overflow,
        output_count: args.output_count,
        pending: propose.id,
        service: serviceTypeRegisterPendingFanout,
        utxos: propose.utxos,
      },
      cbk);
    }],

    // Decode the unsigned PSBT
    transaction: [
      'ecp',
      'propose',
      'register',
      ({ecp, propose, register}, cbk) =>
    {
      const funding = hexAsBuffer(propose.funding);
      const psbt = decodePsbt({ecp, psbt: register.psbt});

      const tx = fromHex(psbt.unsigned_transaction);

      return cbk(null, {
        id: tx.getId(),
        raw: psbt.unsigned_transaction,
        vout: tx.outs.findIndex(n => n.script.equals(funding)),
      });
    }],

    // Publish partial signatures to coordinator
    reveal: ['register', ({register}, cbk) => {
      // Let listeners know that the signature will be sent to coordinator
      emitter.emit('publishing', {
        refund: register.conflict,
        signed: register.psbt,
      });

      return registerSignedOpen({
        coordinator: args.coordinator,
        count: args.count,
        group: args.id,
        lnd: args.lnd,
        signed: register.psbt,
        service: serviceTypeRegisterSignedFanout,
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
