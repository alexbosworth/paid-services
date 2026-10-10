const {isArray} = Array;
const hexLength = bytes => bytes * 2;
const isNumber = n => typeof n === 'string' && /^\d+$/.test(n);
const lengthAmountBytes = 8;
const maxU64 = BigInt('18446744073709551615');

/** Encode suggested amounts as 8 byte amounts one after another

  {
    amounts: [<Suggested Amount String>]
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Encoded Amounts Hex String>
  }
*/
module.exports = ({amounts}) => {
  if (!isArray(amounts) || !amounts.every(isNumber)) {
    throw new Error('ExpectedArrayOfAmountsToEncodeAmounts');
  }

  if (!amounts.every(n => BigInt(n) > BigInt(0) && BigInt(n) <= maxU64)) {
    throw new Error('ExpectedPositiveU64AmountsToEncodeAmounts');
  }

  const encoded = amounts.map(n => {
    return BigInt(n).toString(16).padStart(hexLength(lengthAmountBytes), '0');
  });

  return {encoded: encoded.join(String())};
};
