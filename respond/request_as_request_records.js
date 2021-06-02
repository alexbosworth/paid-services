const {byteEncodeRequest} = require('invoices');
const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const encodeNumber = number => encodeBigSize({number}).encoded;
const requestAmountType = '2';
const requestDetailsType = '1';
const requestWordCount = '0';

/** Encode a BOLT 11 payment request as payment request records

  {
    request: <BOLT 11 Payment Request String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Hex Encoded Payment Request TLV Stream String>
  }
*/
module.exports = ({request}) => {
  if (!request) {
    throw new Error('ExpectedRequestToEncodeAsRequestRecords');
  }

  const records = [];

  // A byte encoded request is separated into payment details and amount
  const {encoded, mtokens, words} = byteEncodeRequest({request});

  records.push({type: requestDetailsType, value: encoded});
  records.push({type: requestWordCount, value: encodeNumber(words)});

  if (!!mtokens) {
    records.push({type: requestAmountType, value: encodeNumber(mtokens)});
  }

  return {encoded: encodeTlvStream({records}).encoded};
};
