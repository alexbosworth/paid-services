const {encodeBigSize} = require('bolt01');

const byteLength = hex => hex.length / 2;
const {isArray} = Array;
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);

/** Encode a list as items one after another, each after its BigSize length

  {
    items: [<Item Hex String>]
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Encoded List Hex String>
  }
*/
module.exports = ({items}) => {
  if (!isArray(items) || !items.every(isHex)) {
    throw new Error('ExpectedArrayOfHexItemsToEncodeList');
  }

  // Each item comes after its byte length, encoded as a BigSize number
  const encoded = items.map(item => {
    const size = encodeBigSize({number: String(byteLength(item))}).encoded;

    return size + item;
  });

  return {encoded: encoded.join(String())};
};
