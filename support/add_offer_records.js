const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const callOrThrow = require('./call_or_throw');

const byType = (a, b) => BigInt(a.type) < BigInt(b.type) ? -1 : 1;

/** Add records to an offer

  {
    offer: <BOLT 12 Offer String>
    records: [{
      type: <Record Type Number String>
      value: <Record Value Hex String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    offer: <BOLT 12 Offer String>
  }
*/
module.exports = args => {
  const {encoded} = callOrThrow({
    error: 'ExpectedValidOfferToAddOfferRecords',
    method: () => parseOffer({offer: args.offer}),
  });

  const {records} = decodeTlvStream({encoded});

  const types = records.map(n => n.type);

  if (!args.records.every(n => !types.includes(n.type))) {
    throw new Error('UnexpectedExistingRecordTypeInOffer');
  }

  const sorted = records.concat(args.records).sort(byType);

  // The offer with the records is parsed to check it is still valid
  const {encoded: added} = encodeTlvStream({records: sorted});

  const offer = parseOffer({encoded: added});

  return {offer: offer.offer};
};
