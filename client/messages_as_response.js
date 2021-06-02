const {decodeTlvStream} = require('bolt01');

const decodeNodesRecord = require('./decode_nodes_record');
const decodeUrlsRecord = require('./decode_urls_record');
const errorRecordsAsError = require('./error_records_as_error');
const {requestRecordsAsRequest} = require('./../records');

const decodeReq = args => requestRecordsAsRequest(args).request;
const decodeTlv = encoded => decodeTlvStream({encoded}).records;
const findCustomRecords = records => records.find(n => n.type === '1');
const findErrorRecords = records => records.find(n => n.type === '0');
const findNodesRecord = records => records.find(n => n.type === '3');
const findPaywallRecords = records => records.find(n => n.type === '2');
const findResponse = records => records.find(n => n.type === '805805');
const findStandardRecords = records => records.find(n => n.type === '0');
const findTextRecord = records => records.find(n => n.type === '1');
const findUrlsRecord = records => records.find(n => n.type === '4');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');
const {isArray} = Array;
const requestArgs = (encoded, network) => ({encoded, network});
const typeValues = n => n.map(({type, value}) => ({type, value}));

/** Derive response details from encoded messages

  {
    messages: [{
      type: <Message Type Number String>
      value: <Message Hex Value String>
    }]
    network: <BitcoinJs Network Name String>
  }

  @throws
  <Error>

  @returns
  {
    [error]: [
      <Error Code Number>
      <Error Message Type String>
    ]
    [links]: [<URL String>]
    [nodes]: [<Node Public Key Hex String>]
    [paywall]: <Response Paywall BOLT 11 Payment Request String>
    [records]: [{
      type: <Record Type Number String>
      value: <Record Type Value Hex String>
    }]
    [text]: <Text Response String>
  }
*/
module.exports = ({messages, network}) => {
  if (!isArray(messages)) {
    throw new Error('ExpectedArrayOfMessagesToDerivePaidServiceResponse');
  }

  if (!network) {
    throw new Error('ExpectedNetworkNameToDerivePaidServiceResponse');
  }

  // The response will be in a paid service response record
  const responseRecord = findResponse(messages);

  // Check that there is a paid service response TLV record
  if (!responseRecord) {
    throw new Error('ExpectedResponseRecordInMessages');
  }

  // Check that the paid service response is a valid TLV stream
  try {
    decodeTlv(responseRecord.value);
  } catch (err) {
    throw new Error('ExpectedResponseRecordsAsValidTlvStream');
  }

  const response = {};

  // The response records are a TLV stream
  const responseRecords = decodeTlv(responseRecord.value);

  // The TLV stream has standard response records and then arbitrary records
  const customRecords = findCustomRecords(responseRecords);
  const standardRecords = findStandardRecords(responseRecords);

  // Check that custom records are a valid TLV stream
  if (!!customRecords) {
    try {
      decodeTlv(customRecords.value);
    } catch (err) {
      throw new Error('ExpectedCustomResponseRecordsAsTlvStream');
    }
  }

  // Check that standard records are a valid TLV stream
  if (!!standardRecords) {
    try {
      decodeTlv(standardRecords.value);
    } catch (err) {
      throw new Error('ExpectedStandardResponseRecordsAsValidTlvStream');
    }
  }

  const standard = !!standardRecords ? decodeTlv(standardRecords.value) : [];

  // A response can have custom records attached
  if (!!customRecords) {
    response.records = typeValues(decodeTlv(customRecords.value));
  }

  // Error records are in the standard response records
  const errorRecords = findErrorRecords(standard);

  if (!!errorRecords) {
    response.error = errorRecordsAsError({encoded: errorRecords.value}).error;
  }

  // A list of URLs is a standard field
  const urlsRecord = findUrlsRecord(standard);

  if (!!urlsRecord) {
    response.links = decodeUrlsRecord({encoded: urlsRecord.value}).urls;
  }

  const nodesRecord = findNodesRecord(standard);

  if (!!nodesRecord) {
    response.nodes = decodeNodesRecord({encoded: nodesRecord.value}).nodes;
  }

  // A paywall is a standard field
  const paywallRecords = findPaywallRecords(standard);

  if (!!paywallRecords) {
    response.paywall = decodeReq(requestArgs(paywallRecords.value, network));
  }

  // A text response is a standard field
  const textRecord = findTextRecord(standard);

  if (!!textRecord) {
    response.text = hexAsUtf8(textRecord.value);
  }

  return response;
};
