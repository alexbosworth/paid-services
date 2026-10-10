const {encodeTlvStream} = require('bolt01');

const amountsAsHex = require('./amounts_as_hex');
const {typeSuggestedAmounts} = require('./constants');
const {typeSuggestedCurrency} = require('./constants');

const {isArray} = Array;
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const isCurrency = n => typeof n === 'string' && /^[A-Z]{3}$/.test(n);

/** Encode the value of an `offer_suggested_amounts` offer record

  Amounts are millitokens, or with a `currency`, amounts of an ISO 4217
  currency in its minor units, like USD cents. The currency is in the same
  record as the amounts, so the amounts are never read without it.

  {
    amounts: [<Suggested Amount String>]
    [currency]: <ISO 4217 Currency Code String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Suggested Amounts TLV Stream Hex String>
  }
*/
module.exports = ({amounts, currency}) => {
  if (currency !== undefined && !isCurrency(currency)) {
    throw new Error('ExpectedIso4217CurrencyCodeToEncodeSuggestedAmounts');
  }

  if (!isArray(amounts) || !amounts.length) {
    throw new Error('ExpectedAmountsToEncodeSuggestedAmounts');
  }

  const amountsRecord = {
    type: typeSuggestedAmounts,
    value: amountsAsHex({amounts}).encoded,
  };

  // Exit early when the amounts are millisatoshis, without a currency
  if (!currency) {
    return encodeTlvStream({records: [amountsRecord]});
  }

  // A currency is its ASCII bytes
  const currencyRecord = {
    type: typeSuggestedCurrency,
    value: bufferAsHex(Buffer.from(currency, 'ascii')),
  };

  return encodeTlvStream({records: [amountsRecord, currencyRecord]});
};
