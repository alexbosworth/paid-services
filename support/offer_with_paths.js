const {decodeTlvStream} = require('bolt01');

const {decodeRecords} = require('./../service_records');
const {typeOfferPaths} = require('./constants');

const hexLength = bytes => bytes * 2;

/** Add the `offer_paths` record of a support offer to an offer listed
  without its paths, keeping the other records exactly as received

  {
    encoded: <Offer TLV Stream Without Paths Hex String>
    paths: <Support Offer Paths TLV Record Hex String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Offer TLV Stream Hex String>
  }
*/
module.exports = ({encoded, paths}) => {
  const {records} = decodeRecords({encoded});

  // An offer without paths cannot already have paths
  if (!!records.find(n => n.type === typeOfferPaths)) {
    throw new Error('UnexpectedPathsInOfferWithoutPaths');
  }

  const [record, ...rest] = decodeTlvStream({encoded: paths}).records;

  if (!record || !!rest.length || record.type !== typeOfferPaths) {
    throw new Error('ExpectedOfferPathsRecordToAddToOffer');
  }

  // Find where the paths record goes, keeping the bytes of the other records
  let start = 0;
  let at = encoded.length;

  decodeTlvStream({encoded: encoded.toLowerCase()}).records.forEach(n => {
    if (at === encoded.length && BigInt(n.type) > BigInt(typeOfferPaths)) {
      at = start;
    }

    start += hexLength(n.length);

    return;
  });

  return {encoded: encoded.slice(0, at) + paths + encoded.slice(at)};
};
