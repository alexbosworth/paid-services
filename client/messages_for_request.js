const {createHash} = require('crypto');

const {byteEncodeRequest} = require('invoices');
const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const bufferAsHex = buffer => buffer.toString('hex');
const encodeNumber = number => encodeBigSize({number: number || '0'}).encoded;
const encodeTlv = records => encodeTlvStream({records}).encoded;
const customRecordsType = '1';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const keySendPreimageType = '5482373484';
const paidServicesType = '805805';
const paymentAmountType = '2';
const paymentDetailsType = '1';
const paymentWordsType = '0';
const paymentType = '3';
const serviceType = '1';
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const standardRecordsType = '0';

/** Derive messages for a paid service request

  Include the keysend message when making a push payment

  {
    [arguments]: <TLV Encoded Hex String>
    reply: <Reply BOLT 11 Payment Request String>
    [secret]: <Payment Preimage Hash Hex String>
    service: <Service Type Number String>
  }

  @throws
  <Error>

  @returns
  {
    [id]: <Payment Preimage Hash Hex String>
    messages: [{
      type: <Request Type Number String>
      value: <TLV Encoded Paid Service Request Hex String>
    }]
  }
*/
module.exports = ({arguments, reply, secret, service}) => {
  if (!reply) {
    throw new Error('ExpectedBolt11EncodedPayReqReplyToGenerateMessages');
  }

  if (!service) {
    throw new Error('ExpectedServiceNumberToGenerateRequestMessages');
  }

  const {encoded, mtokens, words} = byteEncodeRequest({request: reply});
  const id = !!secret ? bufferAsHex(sha256(hexAsBuffer(secret))) : undefined;
  const messages = [];
  const payment = [];
  const records = [];
  const standard = [];

  if (!!arguments) {
    records.push({type: customRecordsType, value: arguments});
  }

  payment.push({type: paymentWordsType, value: encodeNumber(words.toString())});
  payment.push({type: paymentAmountType, value: encodeNumber(mtokens)});
  payment.push({type: paymentDetailsType, value: encoded});

  standard.push({type: paymentType, value: encodeTlv(payment)});
  standard.push({type: serviceType, value: encodeNumber(service)});

  records.push({type: standardRecordsType, value: encodeTlv(standard)});

  messages.push({type: paidServicesType, value: encodeTlv(records)});

  // When a preimage is specified for a keysend, add the keysend record
  if (!!secret) {
    messages.push({type: keySendPreimageType, value: secret});
  }

  return {id, messages};
};
