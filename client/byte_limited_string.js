const byteLength = str => Buffer.byteLength(str, 'utf8');

/** Return a function that limits a string by a byte limit

  {
    limit: <Byte Limit Number>
  }

  @returns
  {
    limited: <Byte Limit String Function>
  }
*/
module.exports = ({limit}) => {
  const limited = string => {
    return (Array.from(string || String()).reduce((sum, char) => {
      // Stop adding chars when the byte limit would be exceeded
      if (sum.limited || byteLength(sum.adjusted + char) > limit) {
        sum.limited = true;

        return sum;
      }

      sum.adjusted += char;

      return sum;
    },
    {adjusted: String(), limited: false})).adjusted;
  };

  return {limited};
};
