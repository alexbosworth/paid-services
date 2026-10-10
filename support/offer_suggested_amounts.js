const {parseOffer} = require('invoices');

const callOrThrow = require('./call_or_throw');
const {decodeRecords} = require('./../service_records');
const decodeSuggestedAmounts = require('./decode_suggested_amounts');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const {typeOfferSuggestedAmounts} = require('./constants');

/** Get the suggested amounts of an offer

  Suggested amounts are totals to pay, as `mtokens`, or as `amounts` in the
  minor units of an ISO 4217 `currency` to convert at an exchange rate,
  leaving out an amount under one millitoken. There are none for an offer
  with an amount, a currency, or a maximum quantity, for an offer that is not
  for one Bitcoin network, or when they cannot be read.

  {
    offer: <BOLT 12 Offer String>
  }

  @throws
  <Error>

  @returns
  {
    [amounts]: [<Suggested Amount in Currency Minor Units String>]
    [currency]: <ISO 4217 Currency Code String>
    mtokens: [<Suggested Amount Millitokens String>]
  }
*/
module.exports = ({offer}) => {
  const details = callOrThrow({
    error: 'ExpectedValidOfferToGetSuggestedAmounts',
    method: () => parseOffer({offer}),
  });

  const isAmount = details.amount !== undefined || (
    details.mtokens !== undefined
  );

  // The payer does not choose the total for an offer with an amount
  if (isAmount || details.max_quantity !== undefined) {
    return {mtokens: []};
  }

  // Amounts are paid in millisatoshis of a Bitcoin network
  if (!offerBitcoinNetwork({offer}).network) {
    return {mtokens: []};
  }

  const {records} = decodeRecords({encoded: details.encoded});

  const amounts = records.find(n => n.type === typeOfferSuggestedAmounts);

  if (!amounts) {
    return {mtokens: []};
  }

  try {
    const decoded = decodeSuggestedAmounts({encoded: amounts.value});

    // Exit early when the amounts are millitokens
    if (!decoded.currency) {
      return {mtokens: decoded.amounts};
    }

    return {
      amounts: decoded.amounts,
      currency: decoded.currency,
      mtokens: [],
    };
  } catch (err) {
    return {mtokens: []};
  }
};
