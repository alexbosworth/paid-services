const asEvenHex = hex => hex.length % 2 ? `0${hex}` : hex;
const isNumber = n => /^\d+$/.test(String(n));
const maxU64 = BigInt('18446744073709551615');

/** Encode a number as a truncated unsigned 64 bit integer (tu64)

  A tu64 is big-endian with no leading zero bytes, so zero has no bytes

  {
    number: <Number or Number String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Truncated Number Hex String>
  }
*/
module.exports = ({number}) => {
  if (number === undefined || !isNumber(number)) {
    throw new Error('ExpectedNumberToEncodeAsTruncatedNumber');
  }

  const value = BigInt(number);

  if (value > maxU64) {
    throw new Error('ExpectedNumberWithinU64RangeToEncodeAsTruncated');
  }

  // Zero is encoded with no bytes
  if (!value) {
    return {encoded: String()};
  }

  // The hex of the number has whole bytes
  return {encoded: asEvenHex(value.toString(16))};
};
