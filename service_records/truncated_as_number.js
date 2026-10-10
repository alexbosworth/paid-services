const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const maxBytes = 8;

/** Decode a truncated unsigned 64 bit integer (tu64)

  {
    encoded: <Truncated Number Hex String>
  }

  @throws
  <Error>

  @returns
  {
    number: <Number String>
  }
*/
module.exports = ({encoded}) => {
  if (!isHex(encoded)) {
    throw new Error('ExpectedHexToDecodeTruncatedNumber');
  }

  if (encoded.length / 2 > maxBytes) {
    throw new Error('ExpectedAtMostEightBytesForTruncatedNumber');
  }

  // A truncated number is minimally encoded with no leading zero bytes
  if (encoded.slice(0, 2) === '00') {
    throw new Error('UnexpectedLeadingZeroInTruncatedNumber');
  }

  return {number: !encoded ? '0' : BigInt(`0x${encoded}`).toString()};
};
