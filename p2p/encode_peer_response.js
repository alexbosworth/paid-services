const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const encodeMessage = message => `626f73ff${message}`;
const encodeResponseCode = require('./encode_response_code');

const headers = null;
const params = null;
const present = n => !!n;
const version = null;

/** Encode a response to a peer

  {
    [failure]: [
      <Failure Code Number>
      <Failure Message String>
    ]
    id: <Request Id Hex String>
    [records]: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    message: <Encoded Hex String>
  }
*/
module.exports = ({failure, id, records}) => {
  const code = encodeResponseCode({failure}).encoded;
  const {encoded} = !!records ? encodeTlvStream({records}) : {};

  const response = [version, id, code, params, headers, encoded]
    .map((value, type) => ({type, value}))
    .filter(n => !!n.value);

  const message = encodeMessage(encodeTlvStream({records: response}).encoded);

  return {message};
};
