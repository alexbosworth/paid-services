const {encodeTlvStream} = require('bolt01');

const {numberAsTruncated} = require('./../service_records');
const offerRecordsForPayer = require('./offer_records_for_payer');
const {typePayerOffer} = require('./constants');
const {typePayerOfferExpiry} = require('./constants');
const {typePayerOfferSignature} = require('./constants');

const {floor} = Math;
const asSeconds = date => !date ? 0 : floor(Date.parse(date) / msPerSecond);
const isDate = n => typeof n === 'string' && !isNaN(Date.parse(n));
const isSignature = n => typeof n === 'string' && /^[0-9a-f]{128}$/i.test(n);
const msPerSecond = 1e3;

/** Encode a payer offer record to add to an invoice request before signing

  A payer offer is the whole `offer`, or a reference to it: a BIP 353 name,
  its issuer id, and for a support offer, its service id and sequence. An
  `expires_at` date has the recipient ignore the payer offer after it. The
  record is encoded to be signed, and with the `signature` once it is signed.

  {
    [bip353_name]: <Payer Offer BIP 353 Human Readable Name String>
    [expires_at]: <Payer Offer Expires At ISO 8601 Date String>
    [issuer_id]: <Payer Offer Issuer Id Public Key Hex String>
    [offer]: <BOLT 12 Payer Offer String>
    [service_id]: <Payer Support Offer Service Id Hex String>
    [service_sequence]: <Payer Support Offer Service Sequence String>
    [signature]: <BIP 340 Payer Offer Signature Hex String>
  }

  @throws
  <Error>

  @returns
  {
    type: <Invoice Request Record Type Number String>
    unsigned: <Payer Offer TLV Stream Without Signature Hex String>
    [value]: <Payer Offer TLV Stream Hex String>
  }
*/
module.exports = args => {
  if (args.expires_at !== undefined && !isDate(args.expires_at)) {
    throw new Error('ExpectedExpiryDateToEncodePayerOffer');
  }

  const expirySeconds = asSeconds(args.expires_at);

  if (args.expires_at !== undefined && expirySeconds <= 0) {
    throw new Error('ExpectedExpiryAfterUnixEpochToEncodePayerOffer');
  }

  if (args.signature !== undefined && !isSignature(args.signature)) {
    throw new Error('ExpectedSignatureToEncodePayerOffer');
  }

  const hasSequence = args.service_sequence !== undefined;

  const referenceFields = [args.bip353_name, args.issuer_id, args.service_id];

  const isReference = !!referenceFields.filter(n => !!n).length;

  if (!!args.offer && (isReference || hasSequence)) {
    throw new Error('ExpectedEitherOfferOrReferenceToEncodePayerOffer');
  }

  const offerRecords = offerRecordsForPayer({
    bip353_name: args.bip353_name,
    issuer_id: args.issuer_id,
    offer: args.offer,
    service_id: args.service_id,
    service_sequence: args.service_sequence,
  })
  .records;

  // A payer offer can have an expiry, after which it is ignored
  const expiryRecord = {
    type: typePayerOfferExpiry,
    value: numberAsTruncated({number: expirySeconds}).encoded,
  };

  const expiry = !expirySeconds ? [] : [expiryRecord];

  // Records are in the order of their types
  const records = offerRecords.concat(expiry).sort((a, b) => {
    return Number(BigInt(a.type) - BigInt(b.type));
  });

  const unsigned = encodeTlvStream({records}).encoded;

  // Exit early when the payer offer is not signed yet
  if (!args.signature) {
    return {unsigned, type: typePayerOffer};
  }

  const {encoded: value} = encodeTlvStream({
    records: records.concat({
      type: typePayerOfferSignature,
      value: args.signature.toLowerCase(),
    }),
  });

  return {unsigned, value, type: typePayerOffer};
};
