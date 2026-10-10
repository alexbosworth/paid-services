const {parseOffer} = require('invoices');

const decodeRecords = require('./decode_records');
const decodeServiceLabel = require('./decode_service_label');
const {typeOfferService} = require('./constants');

/** Read the service label of an offer from its `offer_service` record

  An offer with an `offer_service` record that is not a valid label has no
  service type or version, but `is_labeled` is still set, so that it can be
  told apart from an offer without a label

  {
    offer: <BOLT 12 Offer String>
  }

  @throws
  <Error>

  @returns
  {
    [id]: <Service Id Hex String>
    is_labeled: <Offer Has an Offer Service Record Bool>
    [sequence]: <Service Sequence Number String>
    [type]: <Service Type Number String>
    [version]: <Service Version Number>
  }
*/
module.exports = ({offer}) => {
  // Exit early when the offer cannot be read
  try {
    parseOffer({offer});
  } catch (err) {
    throw new Error('ExpectedValidOfferToReadServiceLabel');
  }

  const {encoded} = parseOffer({offer});

  const {records} = decodeRecords({encoded});

  const label = records.find(n => n.type === typeOfferService);

  // Exit early when the offer is not labeled
  if (!label) {
    return {is_labeled: false};
  }

  try {
    const decoded = decodeServiceLabel({encoded: label.value});

    // The service id and sequence are only given when the label has them
    return {
      is_labeled: true,
      type: decoded.type,
      version: decoded.version,
      ...(!decoded.id ? {} : {id: decoded.id}),
      ...(!decoded.sequence ? {} : {sequence: decoded.sequence}),
    };
  } catch (err) {
    return {is_labeled: true};
  }
};
