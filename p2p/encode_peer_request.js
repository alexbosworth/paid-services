const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const bigSize = number => encodeBigSize({number}).encoded;
const code = null;
const encodeMessage = message => `626f73ff${message}`;
const headers = null;
const {isArray} = Array;
const recordsAsTlvStream = records => encodeTlvStream({records}).encoded;
const version = null;

/** Encode a peer request

  {
    id: <Request Id Hex String>
    [records]: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
    type: <Type Number String>
  }

  @throws
  <Error>

  @returns
  {
    message: <Hex Encoded Mesage String>
  }
*/
module.exports = ({id, records, type}) => {
  if (!id) {
    throw new Error('ExpectedRequestIdHexStringToEncodePeerRequest');
  }

  if (!!records && !isArray(records)) {
    throw new Error('ExpectedRecordsArrayToEncodePeerRequest');
  }

  if (!type) {
    throw new Error('ExpectedRequestTypeToEncodePeerRequest');
  }

  // Encode the request records
  const response = [version, id, code, bigSize(type), headers, records]
    .map((value, type) => ({type, value}))
    .filter(n => !!n.value)
    .map(({type, value}) => {
      if (!isArray(value)) {
        return {type, value};
      }

      return {type, value: recordsAsTlvStream(value)};
    })
    .map(({value, type}) => ({value, type: type.toString()}));

  // Return the encoded request message
  return {message: encodeMessage(recordsAsTlvStream(response))};
};
