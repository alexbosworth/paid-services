const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const defaultRecord = {value: ''};
const findCodeRecord = records => records.find(n => n.type === '0');
const findMessageRecord = records => records.find(n => n.type === '1');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');
const isFailure = n => n > BigInt(400);
const isTooBig = n => n > BigInt(Number.MAX_SAFE_INTEGER);
const isTooSmall = n => n < BigInt(100);

/** Parse a response code TLV stream

  {
    encoded: <Encoded Response Code Value Hex String>
  }

  @throws
  <Error>

  @returns
  {
    [failure]: [
      <Failure Code Number>
      <Failure Code String>
    ]
  }
*/
module.exports = ({encoded}) => {
  if (!encoded) {
    throw new Error('ExpectedResponseCodeValueToParseResponseCode');
  }

  const {records} = decodeTlvStream({encoded});

  const codeRecord = findCodeRecord(records);

  if (!codeRecord) {
    throw new Error('ExpectedCodeRecordToParseResponseCode');
  }

  const code = BigInt(decodeBigSize({encoded: codeRecord.value}).decoded);

  if (isTooBig(code)) {
    throw new Error('UnexpectedlyLargeResponseCodeInResponse');
  }

  if (isTooSmall(code)) {
    throw new Error('UnexpectedlySmallResponseCodeInResponse');
  }

  // Exit early when the response code is not a failure
  if (!isFailure(code)) {
    return {};
  }

  const messageRecord = findMessageRecord(records) || defaultRecord;

  return {failure: [Number(code), hexAsUtf8(messageRecord.value)]};
};
