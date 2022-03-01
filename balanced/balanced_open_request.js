const {parsePaymentRequest} = require('invoices');

const {balancedChannelKeyTypes} = require('./service_key_types');

const expectedRequestMtokens = '10000';
const expectedResponseMtokens = '1000';
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString();
const isHexHashSized = hex => hex.length === 64;
const isHexNumberSized = hex => hex.length < 14;
const isOdd = n => n % 2;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const parseHexNumber = hex => parseInt(hex, 16);

/** Derive a balanced open request from a received payment

  {
    confirmed_at: <Received Request At ISO 8601 Date String>
    is_push: <Received Funds as Push Payment Bool>
    payments: [{
      messages: [{
        type: <Message Record TLV Type String>
        value: <Message Record Value Hex String>
      }]
    }]
    received_mtokens: <Received Millitokens String>
  }

  @returns
  {
    [proposal]: {
      accept_request: request,
      capacity: parseHexNumber(channelCapacity.value),
      fee_rate: parseHexNumber(fundingFeeRate.value),
      partner_public_key: destination,
      proposed_at: invoice.confirmed_at,
      remote_multisig_key: remoteMultiSigKey.value,
      remote_tx_id: remoteTxId.value,
      remote_tx_vout: parseHexNumber(remoteTxVout.value),
    }
  }
*/
module.exports = args => {
  // Exit early when not receiving a push of the proposal amount
  if (!args.is_push || args.received_mtokens !== expectedRequestMtokens) {
    return {}
  }

  const payment = args.payments.find(payment => {
    return !!payment.messages.find(({type}) => {
      return type === balancedChannelKeyTypes.accept_request;
    });
  });

  // Exit early when there is no payment with an accept request
  if (!payment) {
    return {};
  }

  // The accept request is the reply request for the proposal
  const acceptRequest = payment.messages.find(({type}) => {
    return type === balancedChannelKeyTypes.accept_request;
  });

  const request = hexAsUtf8(acceptRequest.value);

  // Make sure the accept payment request is a regular one
  try {
    parsePaymentRequest({request});
  } catch (err) {
    return {};
  }

  const {destination, mtokens} = parsePaymentRequest({request});

  // The accept payment request should request the expected amount
  if (mtokens !== expectedResponseMtokens) {
    return {};
  }

  // Find the requested channel capacity
  const channelCapacity = payment.messages.find(({type}) => {
    return type === balancedChannelKeyTypes.channel_capacity;
  });

  // Exit early when there is no channel capacity
  if (!channelCapacity || !isHexNumberSized(channelCapacity.value)) {
    return {};
  }

  // Exit early when the capacity doesn't make sense for splitting equally
  if (isOdd(parseHexNumber(channelCapacity.value))) {
    return {};
  }

  // Find the requested chain fee rate
  const fundingFeeRate = payment.messages.find(({type}) => {
    return type === balancedChannelKeyTypes.funding_tx_fee_rate;
  });

  // Exit early when there is no fee rate
  if (!fundingFeeRate || !isHexNumberSized(fundingFeeRate.value)) {
    return {};
  }

  // There must be a non-zero fee rate
  if (!parseHexNumber(fundingFeeRate.value)) {
    return {};
  }

  // Find the remote multisig key for the open
  const remoteMultiSigKey = payment.messages.find(({type}) => {
    return type === balancedChannelKeyTypes.multisig_public_key;
  });

  // Exit early when there is no remote multisig key
  if (!remoteMultiSigKey) {
    return {};
  }

  // The remote multisig key must be a public key
  if (!isPublicKey(remoteMultiSigKey.value)) {
    return {};
  }

  // Find the remote transaction UTXO transaction id
  const remoteTxId = payment.messages.find(({type}) => {
    return type === balancedChannelKeyTypes.transit_tx_id;
  });

  // Exit early when there is no tx id
  if (!remoteTxId || !isHexHashSized(remoteTxId.value)) {
    return {};
  }

  // Find the remote transaction UTXO transaction output index
  const remoteTxVout = payment.messages.find(({type}) => {
    return type === balancedChannelKeyTypes.transit_tx_vout;
  });

  // Exit early when there is no tx vout
  if (!remoteTxVout || !isHexNumberSized(remoteTxVout.value)) {
    return {};
  }

  return {
    accept_request: request,
    capacity: parseHexNumber(channelCapacity.value),
    fee_rate: parseHexNumber(fundingFeeRate.value),
    partner_public_key: destination,
    proposed_at: args.confirmed_at,
    remote_multisig_key: remoteMultiSigKey.value,
    remote_tx_id: remoteTxId.value,
    remote_tx_vout: parseHexNumber(remoteTxVout.value),
  };
};
