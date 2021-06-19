const {decodeTlvStream} = require('bolt01');
const {parsePaymentRequest} = require('invoices');

const {invoiceNetwork} = require('./../config');
const requestRecordsAsRequest = require('./request_records_as_request');

const defaultCltvDelta = 40;
const findRequest = records => records.find(n => n.type === '0');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');

/** Decode relay arguments

  {
    arguments: <Client Arguments TLV Hex String>
    network: <Network Name String>
  }

  @throws
  <Error>

  @returns
  {
    cltv_delta: <Final CLTV Delta Number>
    description: <Payment Description String>
    description_hash: <Payment Longer Description Hash String>
    destination: <Public Key String>
    expires_at: <ISO 8601 Date String>
    features: [{
      bit: <BOLT 09 Feature Bit Number>
      is_known: <Feature is Known Bool>
      is_required: <Feature Support is Required To Pay Bool>
      type: <Feature Type String>
    }]
    id: <Payment Hash String>
    mtokens: <Requested Millitokens String>
    [payment]: <Payment Identifier Hex Encoded String>
    routes: [[{
      [base_fee_mtokens]: <Base Routing Fee In Millitokens String>
      [channel]: <Standard Format Channel Id String>
      [cltv_delta]: <CLTV Blocks Delta Number>
      [fee_rate]: <Fee Rate In Millitokens Per Million Number>
      public_key: <Forward Edge Public Key Hex String>
    }]]
  }
*/
module.exports = ({arguments, network}) => {
  if (!arguments) {
    throw new Error('ExpectedArgumentsToDecodeRelayArguments');
  }

  try {
    decodeTlvStream({encoded: arguments});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForRelayArguments');
  }

  if (!network || !invoiceNetwork[network]) {
    throw new Error('ExpectedNetworkNameToDecodeRelayArguments');
  }

  // Arguments are a TLV stream
  const {records} = decodeTlvStream({encoded: arguments});

  // There should be a request record
  if (!findRequest(records)) {
    throw new Error('ExpectedPaymentRequestForRelay');
  }

  // Make sure that the request records map to a request
  try {
    requestRecordsAsRequest({
      encoded: findRequest(records).value,
      network: invoiceNetwork[network],
    });
  } catch (err) {
    throw new Error('ExpectedValidPaymentRequestRecordsForRelay');
  }

  const {request} = requestRecordsAsRequest({
    encoded: findRequest(records).value,
    network: invoiceNetwork[network],
  });

  // The payment request is expected to be valid
  try {
    parsePaymentRequest({request});
  } catch (err) {
    throw new Error('ExpectedValidPaymentRequestInRelayArguments');
  }

  const invoice = parsePaymentRequest({request});

  if (invoice.is_expired) {
    throw new Error('ExpectedUnexpiredPaymentRequest');
  }

  return {
    cltv_delta: invoice.cltv_delta || defaultCltvDelta,
    description: invoice.description,
    description_hash: invoice.description_hash,
    destination: invoice.destination,
    expires_at: invoice.expires_at,
    features: invoice.features,
    id: invoice.id,
    mtokens: invoice.mtokens,
    payment: invoice.payment,
    routes: invoice.routes,
  };
};
