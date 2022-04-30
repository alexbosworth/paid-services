const {decodeTlvStream} = require('bolt01');

const recordAsNode = require('./record_as_node');

const findSwapRecord = records => records.find(n => n.type === '6');
const {isArray} = Array;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const nodeForSwap = record => record.substring(0, 66);
const requestForSwap = record => record.substring(66);

/** Decode swap trade records

  6: <Swap Request>

  {
    records: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    node: <Node Public Key Id Hex String>
    request: <Swap Request Hex String>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeSwapTrade');
  }

  const swapRecord = findSwapRecord(records);

  if (!swapRecord) {
    throw new Error('ExpectedSwapRecordInSwapTrade');
  }

  const node = nodeForSwap(swapRecord.value)

  if (!isPublicKey(node)) {
    throw new Error('ExpectedIdentityPublicKeyInSwapTrade');
  }

  const request = requestForSwap(swapRecord.value);

  if (!request) {
    throw new Error('ExpectedSwapRequestInSwapTrade');
  }

  return {node, request};
};
