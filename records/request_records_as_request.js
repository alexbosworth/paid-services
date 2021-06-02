const {byteDecodeRequest} = require('invoices');
const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const asNumber = encoded => Number(decodeBigSize({encoded}).decoded);
const findAmt = records => records.find(n => n.type === '2') || {value: '00'};
const findDetails = records => records.find(n => n.type === '1');
const findWords = records => records.find(n => n.type === '0');

/** Decode request records as a BOLT 11 payment request

  Encoded TLV Stream:
  0: <Payment Request Words Count>
  1: <Byte Encoded Payment Request Details>
  [2]: <Amount Millitokens>

  {
    encoded: <Payment Request TLV Stream Hex String>
    network: <BitcoinJs Network Name String>
  }

  @throws
  <Error>

  @returns
  {
    request: <BOLT 11 Payment Request String>
  }
*/
module.exports = ({encoded, network}) => {
  if (!encoded) {
    throw new Error('ExpectectedEncodedPaymentRequestRecordsToDecode');
  }

  if (!network) {
    throw new Error('ExpectedNetworkNameToDeriveRequestFromRequestRecords');
  }

  try {
    decodeTlvStream({encoded});
  } catch (err) {
    throw new Error('ExpectedTlvEncodedPaymentRecordsToDecodeRequest');
  }

  const {records} = decodeTlvStream({encoded});

  const wordCountRecord = findWords(records);

  if (!wordCountRecord) {
    throw new Error('ExpectedWordCountRecordInPaymentTlvRecord');
  }

  try {
    asNumber(wordCountRecord.value);
  } catch (err) {
    throw new Error('ExpectedPaymentRequestWordCountInRequestRecords');
  }

  const words = asNumber(wordCountRecord.value);

  const details = findDetails(records);

  if (!details) {
    throw new Error('ExpectedEncodedPaymentDetailsInPaymentTlvRecord');
  }

  const amount = findAmt(records);

  try {
    decodeBigSize({encoded: amount.value});
  } catch (err) {
    throw new Error('ExpectedPaymentRequestTokensInPaymentRecords');
  }

  const mtokens = decodeBigSize({encoded: amount.value}).decoded;

  try {
    byteDecodeRequest({mtokens, network, words, encoded: details.value});
  } catch (err) {
    throw new Error('ExpectedValidPaymentRequestDetailsToDecodeRecords');
  }

  const {request} = byteDecodeRequest({
    mtokens,
    network,
    words,
    encoded: details.value,
  });

  return {request};
};
