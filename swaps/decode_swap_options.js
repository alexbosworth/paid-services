const {swapRequestOptions} = require('./swap_field_types');

const bits = 8;
const {from} = Array;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isEven = number => !(number % 2);
const range = len => Array.from(Array(len).keys());

/** Decode swap options

  {
    [encoded]: <Serialized Swap Options Hex String>
  }

  @throws
  <Error>

  @returns
  {
    options: [{
      named: <Option Name String>
      number: <Option Number>
    }]
  }
*/
module.exports = ({encoded}) => {
  // Exit early when there are no options
  if (!encoded) {
    return {options: []};
  }

  const elements = hexAsBuffer(encoded);
  const options = new Set();

  const endIndex = elements.length - 1;

  elements.forEach((element, index) => {
    return range(bits)
      .filter(i => element & 1 << i)
      .forEach(i => options.add((endIndex - index) * bits + i))
  });

  return {
    options: from(options).sort().map(number => ({
      number,
      named: swapRequestOptions[number.toString()],
    })),
  };
};
