const {decodeBigSize} = require('bolt01');

const byteLength = hex => hex.length / 2;
const hexLength = bytes => bytes * 2;
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const stepsOf = count => Array.from({length: count});

/** Decode a list of items that each come after their BigSize length

  {
    encoded: <Encoded List Hex String>
  }

  @throws
  <Error>

  @returns
  {
    items: [<Item Hex String>]
  }
*/
module.exports = ({encoded}) => {
  if (!isHex(encoded)) {
    throw new Error('ExpectedHexToDecodeList');
  }

  // Every item has at least a byte of length, which bounds the item count
  const steps = stepsOf(byteLength(encoded));

  // Read items one after another until there is nothing left to read
  const {items} = steps.reduce(({items, rest}) => {
    // Exit early when every item has been read
    if (!rest) {
      return {items, rest};
    }

    // The length of the item has to be readable
    try {
      decodeBigSize({encoded: rest});
    } catch (err) {
      throw new Error('ExpectedItemLengthInList');
    }

    const size = decodeBigSize({encoded: rest});

    const start = hexLength(size.length);
    const end = start + hexLength(Number(size.decoded));

    if (end > rest.length) {
      throw new Error('ExpectedItemOfItsLengthInList');
    }

    items.push(rest.slice(start, end));

    return {items, rest: rest.slice(end)};
  },
  {items: [], rest: encoded});

  return {items};
};
