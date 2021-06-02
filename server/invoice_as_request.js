const {byteDecodeRequest} = require('invoices');
const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const {invoiceNetwork} = require('./../config');
const {requestRecordsAsRequest} = require('./../records');
const {schema} = require('./../services');

const decodeNumber = record => decodeBigSize({encoded: record.value || '00'});
const findAmount = records => records.find(n => n.type === '2');
const findCustomArgumentsRecord = records => records.find(n => n.type === '1');
const findPaidServiceRequest = msgs => msgs.find(n => n.type === '805805');
const findPayment = records => records.find(n => n.type === '3');
const findStandardRequestRecord = records => records.find(n => n.type === '0');
const findServiceType = records => records.find(n => n.type === '1');
const findVersion = records => records.find(n => n.type === '0');
const {isArray} = Array;
const {keys} = Object;
const knownVersion = '0';

/** Map invoice details to a paid services request request

  An 805805 message carries the request data:

  0: (Standard Request Data)
    0: <Paid Services Version Number>
    1: <Paid Service Type Number>
    2: <Reply Amount Number> // Optional amount to pay back
    3: <Reply Payment Request Data Buffer> // Response payment request
  1: (Request Arguments)
    <None>

  {
    is_confirmed: <Invoice is Confirmed Bool>
    [is_push]: <Invoice is Push Payment Bool>
    network: <Network Name String>
    payments: [{
      is_confirmed: <Payment is Confirmed Bool>
      messages: [{
        type: <Message Type Number String>
        value: <Raw Value Hex String>
      }]
    }]
  }

  @throws
  <Error>

  @returns
  {
    [error]: [
      <Error Number>
      <Error Type String>
    ]
    [request]: <BOLT 11 Encoded Respond Payment Request String>
    [service]: {
      [arguments]: <TLV Stream Arguments Hex String>
      type: <Request Type Number>
      version: <Request Paid Services Version Number>
    }
  }
*/
module.exports = args => {
  if (!args.network) {
    throw [500, 'ExpectedNetworkNameToMapInvoiceToPaidServiceRequest'];
  }

  if (!invoiceNetwork[args.network]) {
    throw [500, 'ExpectedKnownNetworkNameToMapInvoiceToPaidServiceRequest'];
  }

  if (!isArray(args.payments)) {
    throw [500, 'ExpectedInvoicePaymentsToMapInvoiceToPaidServiceRequest'];
  }

  // Exit early when there is no push payment
  if (!args.is_confirmed || !args.is_push) {
    return {};
  }

  // A paid service request is encoded in an 805805 record in a push payment
  const payment = args.payments.find(htlc => {
    return htlc.is_confirmed && !!findPaidServiceRequest(htlc.messages);
  });

  // Exit early when there is no paid service record
  if (!payment) {
    return {};
  }

  const {value} = findPaidServiceRequest(payment.messages);

  // Exit early when the paid service record is not a TLV stream
  try {
    decodeTlvStream({encoded: value});
  } catch (err) {
    throw [400, 'ExpectedPaidServiceRecordTlvStreamData'];
  }

  // The paid service record contains the paid service request details
  const {records} = decodeTlvStream({encoded: value});

  // The standard request arguments are in the 0 record
  const standardRequestRecord = findStandardRequestRecord(records);

  // Custom request arguments are in the 1 record
  const arguments = (findCustomArgumentsRecord(records) || {}).value;

  // Make sure that the arguments decode as a TLV stream
  if (!!arguments) {
    try {
      decodeTlvStream({encoded: arguments});
    } catch (err) {
      throw [400, 'ExpectedTlvStreamEncodedArgumentsForPaidServiceRequest'];
    }
  }

  // Exit early when there is no standard request record
  if (!standardRequestRecord) {
    throw [400, 'ExpectedStandardRequestRecordInPaidServiceRequest'];
  }

  // Exit early when the standard request record is not a TLV stream
  try {
    decodeTlvStream({encoded: standardRequestRecord.value});
  } catch (err) {
    throw [400, 'ExpectedStandardRequestTlvRecordsForPaidServiceRequest'];
  }

  // A request will have some standard fields encoded in a TLV record
  const standardRequest = decodeTlvStream({
    encoded: standardRequestRecord.value,
  });

  // Payment request data is encoded to provide for responding to a request
  const paymentRecord = findPayment(standardRequest.records);

  // If there is no payment record then there's no way to respond to a request
  if (!paymentRecord) {
    throw [400, 'ExpectedPaymentRecordDataInPaidServiceRequest'];
  }

  // The payment request amount is encoded separately to the request details
  const paymentAmount = findAmount(standardRequest.records);

  if (!!paymentAmount) {
    try {
      decodeNumber(paymentAmount);
    } catch (err) {
      throw [400, 'ExpectedBigSizeEncodedNumberForPaymentRequestAmount'];
    }
  }

  // The payment request is in byte encoding but it should map to a bolt11 req
  try {
    requestRecordsAsRequest({
      encoded: paymentRecord.value,
      network: invoiceNetwork[args.network],
    });
  } catch (err) {
    throw [400, 'FailedToDecodePaymentRequestDetailsFromRecords', {err}];
  }

  // At this point, a request can return any further errors encountered
  const {request} = requestRecordsAsRequest({
    encoded: paymentRecord.value,
    network: invoiceNetwork[args.network],
  });

  // An optional version record encodes the request service version
  const versionRecord = findVersion(standardRequest.records);

  // Exit early when the version record is invalid
  if (!!versionRecord) {
    try {
      decodeNumber(versionRecord);
    } catch (err) {
      return {request, error: [400, 'UnexpectedEncodingOfPaidServiceVersion']};
    }
  }

  // Service version number
  const version = decodeNumber(versionRecord || {}).decoded;

  // Exit early when the version number is unknown
  if (version !== knownVersion) {
    return {request, error: [400, 'UnexpectedVersionNumberForServiceRequest']};
  }

  // A service type record encodes which paid service is requested
  const serviceTypeRecord = findServiceType(standardRequest.records);

  // Decode the service type bytes to a number
  const type = decodeNumber(serviceTypeRecord || {}).decoded;

  // Exit early when the service type is unknown
  if (!keys(schema.ids).includes(type)) {
    return {request, error: [404, 'UnknownServiceType']};
  }

  return {request, service: {arguments, type, version}};
};
