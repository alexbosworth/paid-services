const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const codeForSuccess = 200;
const {isArray} = Array;
const string = n => n.toString();
const success = n => [{type: '0', value: encodeBigSize({number: n}).encoded}];
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Encode a response code

  {
    [failure]: [
      <Failure Code Number>
      <Failure Message String>
    ]
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Encoded Hex String>
  }
*/
module.exports = ({failure}) => {
  if (!failure) {
    return encodeTlvStream({records: success(codeForSuccess)});
  }

  if (!isArray(failure)) {
    throw new Error('ExpectedFailureArrayToEncodeResponseCode');
  }

  const [code, message] = failure;

  if (!code) {
    throw new Error('ExpectedErrorCodeToEncodeResponseCode');
  }

  const number = code.toString();

  const elements = [encodeBigSize({number}).encoded, utf8AsHex(message)];

  const records = elements.map((value, type) => ({value, type: string(type)}));

  return encodeTlvStream({records});
};
