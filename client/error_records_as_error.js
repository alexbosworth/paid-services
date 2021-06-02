const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const findCode = records => records.find(n => n.type === '0');
const findMessage = records => records.find(n => n.type === '1');
const hexAsString = hex => Buffer.from(hex, 'hex').toString('utf8');

/** Derive an error from an error record

  {
    encoded: <Error Record Hex String>
  }

  @throws
  <Error>

  @return
  {
    error: [
      <Error Code Number>
      <Error Code String>
    ]
  }
*/
module.exports = ({encoded}) => {
  // Exit early when there is no error record
  if (!encoded) {
    throw new Error('ExpectedEncodedErrorToDecodeErrorRecords');
  }

  try {
    decodeTlvStream({encoded});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamEncodedError');
  }

  const {records} = decodeTlvStream({encoded});

  const codeRecord = findCode(records);

  if (!codeRecord) {
    throw new Error('ExpectedErrorCodeRecordInErrorRecords');
  }

  try {
    decodeBigSize({encoded: codeRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidBigSizeEncodedErrorCode');
  }

  const code = Number(decodeBigSize({encoded: codeRecord.value}).decoded);

  const messageRecord = findMessage(records);

  if (!messageRecord) {
    throw new Error('ExpectedErrorMessageRecordToDecodeErrorRecordsAsError');
  }

  return {error: [code, hexAsString(messageRecord.value)]};
};
