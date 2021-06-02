const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const encode = records => encodeTlvStream({records}).encoded;
const encodeNumber = number => encodeBigSize({number}).encoded;
const encodeString = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
const errorCodeType = '0';
const errorMessageType = '1';
const {isArray} = Array;
const isNumber = n => !isNaN(n);

/** Convert an error into error records

  {
    error: [
      <Code Number>
      <Type String>
    ]
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Error Encoded Hex String>
  }
*/
module.exports = ({error}) => {
  if (!isArray(error)) {
    throw new Error('ExpectedErrorArrayToDeriveErrorRecordsForError');
  }

  if (!isNumber(error.slice().shift())) {
    throw new Error('ExpectedErrorNumericCodeToDeriveErrorRecordsForError');
  }

  const [code, message] = error;

  if (!message) {
    throw new Error('ExpectedErrorMessageToEncodeErrorIntoErrorRecords');
  }

  const codeRecord = {type: errorCodeType, value: encodeNumber(code)};
  const messageRecord = {type: errorMessageType, value: encodeString(message)};

  return {encoded: encode([codeRecord, messageRecord])};
};
