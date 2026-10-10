const callOrThrow = require('./call_or_throw');
const {decodeRecords} = require('./../service_records');
const hasUnknownEvenRecord = require('./has_unknown_even_record');
const hexAsAmounts = require('./hex_as_amounts');
const {typeSuggestedAmounts} = require('./constants');
const {typeSuggestedCurrency} = require('./constants');

const knownTypes = [typeSuggestedAmounts, typeSuggestedCurrency];

/** Decode the value of an `offer_suggested_amounts` offer record

  A value that is not a valid TLV stream, that has an unknown even record,
  that has no amounts, amounts that are not 8 byte amounts above zero, or a
  currency that is not three upper case letters cannot be used.

  {
    encoded: <Suggested Amounts TLV Stream Hex String>
  }

  @throws
  <Error>

  @returns
  {
    amounts: [<Suggested Amount String>]
    [currency]: <ISO 4217 Currency Code String>
  }
*/
module.exports = ({encoded}) => {
  const {records} = callOrThrow({
    error: 'ExpectedTlvStreamOfSuggestedAmounts',
    method: () => decodeRecords({encoded}),
  });

  const unknown = hasUnknownEvenRecord({records, known: knownTypes});

  // Unknown even records cannot be ignored
  if (unknown.is_unknown_even) {
    throw new Error('UnexpectedUnknownRequiredRecordInSuggestedAmounts');
  }

  const amounts = records.find(n => n.type === typeSuggestedAmounts);
  const currency = records.find(n => n.type === typeSuggestedCurrency);

  if (!amounts || !amounts.value) {
    throw new Error('ExpectedAmountsInSuggestedAmounts');
  }

  const decoded = hexAsAmounts({encoded: amounts.value});

  // Exit early when the amounts are millitokens
  if (!currency) {
    return {amounts: decoded.amounts};
  }

  const code = Buffer.from(currency.value, 'hex').toString('latin1');

  if (!/^[A-Z]{3}$/.test(code) || currency.value.length !== 6) {
    throw new Error('ExpectedIso4217CurrencyCodeInSuggestedAmounts');
  }

  return {amounts: decoded.amounts, currency: code};
};
