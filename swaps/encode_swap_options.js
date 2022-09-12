const bits = 8;
const bufferAsHex = buffer => buffer.toString('hex');
const {floor} = Math;
const {max} = Math;

/** Encode swap toggled options

  {
    options: [<Option Number>]
  }

  @returns
  {
    [encoded]: <Options Serialized Hex String>
  }
*/
module.exports = ({options}) => {
  // Exit early when there are no options
  if (!options.length) {
    return {};
  }

  const data = Buffer.alloc(floor(max(...options) / bits) + 1);

  const endIndex = data.length - 1;

  options.forEach(n => data[endIndex - floor(n / bits)] |= 1 << n % bits);

  return {encoded: bufferAsHex(data)};
};
