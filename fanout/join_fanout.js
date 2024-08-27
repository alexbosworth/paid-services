const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const {decodePsbt} = require('psbt');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');

const getFundingDetails = require('./get_funding_details');
const {registerGroupConnected} = require('./../groups/p2p');
const {registerPendingOpen} = require('./../groups/p2p');
const {registerSignedOpen} = require('./../groups/p2p');
const {serviceTypeRegisterPendingFanout} = require('./../service_types')
const {serviceTypeRegisterSignedFanout} = require('./../service_types')

const {fromHex} = Transaction;
const {isArray} = Array;
const isNumber = n => !isNaN(n);

/** Join a fanout group

  {
    capacity: <Fanout Output Capacity Tokens Number>
    coordinator: <Fanout Group Coordinator Public Key Hex String>
    count: <Group Members Number>
    id: <Group Id Hex String>
    inputs: [<Utxo Outpoints String>]
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
        return cbk([400, 'ExpectedGroupFanoutOutputCapacityToJoinFanout']);
      }

      if (!args.coordinator) {
        return cbk([400, 'ExpectedFanoutGroupCoordinatorIdToJoinFanout']);
      }

      if (!args.count) {
        return cbk([400, 'ExpectedMembersCountToJoinFanout']);
      }

      if (!args.id) {
        return cbk([400, 'ExpectedGroupIdToJoinFanout']);
      }

      if (!args.inputs.length) {
        return cbk([400, 'ExpectedArrayOfUtxosToJoinFanout']);
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

    // Confirm connected the partners
    connected: ['validate', ({}, cbk) => {
      return registerGroupConnected({
        coordinator: args.coordinator,
        count: args.count,
        id: args.id,
        lnd: args.lnd,
      }, cbk);
    }],

    // Get the funding details for the fanout
    getFundingInfo: ['connected', ({}, cbk) => {
      return getFundingDetails({
        capacity: args.capacity,
        count: args.count,
        inputs: args.inputs,
        lnd: args.lnd,
        output_count: args.output_count,
        rate: args.rate,
      },
      cbk);
    }],

    // Register pending proposal and sign and fund
    register: ['getFundingInfo', ({getFundingInfo}, cbk) => {
      return registerPendingOpen({
        capacity: args.capacity,
        coordinator: args.coordinator,
        change: getFundingInfo.change,
        funding: getFundingInfo.funding,
        group: args.id,
        lnd: args.lnd,
        overflow: getFundingInfo.overflow,
        output_count: args.output_count,
        pending: getFundingInfo.id,
        service: serviceTypeRegisterPendingFanout,
        utxos: getFundingInfo.utxos,
      },
      cbk);
    }],

    // Decode the unsigned PSBT
    transaction: [
      'ecp',
      'register',
      ({ecp, register}, cbk) =>
    {
      const psbt = decodePsbt({ecp, psbt: register.psbt});

      const tx = fromHex(psbt.unsigned_transaction);

      return cbk(null, {
        id: tx.getId(),
        raw: psbt.unsigned_transaction,
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
