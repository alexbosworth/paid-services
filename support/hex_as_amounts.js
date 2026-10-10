const hexLengthAmount = 16;
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const splitAmounts = /.{16}/g;

/** Decode suggested amounts from 8 byte amounts one after another

  {
    encoded: <Encoded Amounts Hex String>
  }

  @throws
  <Error>

  @returns
  {
    amounts: [<Suggested Amount String>]
  }
*/
module.exports = ({encoded}) => {
  if (!isHex(encoded) || encoded.length % hexLengthAmount) {
    throw new Error('ExpectedEightByteAmountsToDecodeAmounts');
  }

  const amounts = (encoded.match(splitAmounts) || []).map(amount => {
    return BigInt(`0x${amount}`);
  });

  // A suggested amount of zero is not an amount to pay
  if (!amounts.every(amount => !!amount)) {
    throw new Error('ExpectedPositiveAmountsToDecodeAmounts');
  }

  return {amounts: amounts.map(amount => amount.toString())};
};
