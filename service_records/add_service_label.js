const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const encodeServiceLabel = require('./encode_service_label');
const {typeOfferService} = require('./constants');

/** Add a service label to an offer as its `offer_service` record

  The record is in the experimental range of offer records and is odd, so
  payers that do not know it pay the offer as normal and copy the record into
  their invoice requests. `offer_metadata` is left for the issuer to use.

  {
    [id]: <Service Id Hex String>
    offer: <BOLT 12 Offer String>
    [sequence]: <Service Sequence Number String>
    type: <Service Type Number String>
    version: <Service Version Number>
  }

  @throws
  <Error>

  @returns
  {
    offer: <Labeled BOLT 12 Offer String>
  }
*/
module.exports = ({id, offer, sequence, type, version}) => {
  // Exit early when the offer cannot be read
  try {
    parseOffer({offer});
  } catch (err) {
    throw new Error('ExpectedValidOfferToAddServiceLabel');
  }

  const {encoded} = parseOffer({offer});

  const {records} = decodeTlvStream({encoded});

  if (!!records.find(n => n.type === typeOfferService)) {
    throw new Error('UnexpectedExistingServiceLabelInOffer');
  }

  const label = {
    type: typeOfferService,
    value: encodeServiceLabel({id, sequence, type, version}).encoded,
  };

  // Records are put in order of their types when they are encoded
  const labeled = encodeTlvStream({records: records.concat(label)});

  return {offer: parseOffer({encoded: labeled.encoded}).offer};
};
