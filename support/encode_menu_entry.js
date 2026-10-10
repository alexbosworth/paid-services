const {encodeTlvStream} = require('bolt01');
const {isPoint} = require('tiny-secp256k1');
const {parseOffer} = require('invoices');

const bip353NameAsHex = require('./bip353_name_as_hex');
const callOrThrow = require('./call_or_throw');
const {numberAsTruncated} = require('./../service_records');
const {typeEntryIssuerId} = require('./constants');
const {typeEntryName} = require('./constants');
const {typeEntryOffer} = require('./constants');
const {typeEntryOfferWithoutPaths} = require('./constants');
const {typeEntryServiceId} = require('./constants');
const {typeEntryServiceSequence} = require('./constants');
const {typeOfferPaths} = require('./constants');
const {withoutRecord} = require('./../service_records');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isKey = n => isHex(n) && n.length === 66 && isPoint(hexAsBuffer(n));
const isSequence = n => /^\d+$/.test(String(n)) && BigInt(n) < maxSequence;
const isServiceId = n => isHex(n) && n.length === 32;
const maxSequence = BigInt('18446744073709551616');

/** Encode an entry of a support menu: a whole offer, an offer of the
  recipient without its paths, or a reference to an offer at a BIP 353 name

  Only list an offer without its paths when it has the issuer id of the
  support offer and is answered on the paths of the support offer. A
  reference to a support offer can have its service sequence, so that a
  reader does not use an older version found at the name.

  {
    [bip353_name]: <Offer BIP 353 Human Readable Name String>
    [is_without_paths]: <Leave Out the Offer Paths Bool>
    [issuer_id]: <Offer Issuer Id Public Key Hex String>
    [offer]: <BOLT 12 Offer String>
    [service_id]: <Support Offer Service Id Hex String>
    [service_sequence]: <Lowest Support Offer Service Sequence Number String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Menu Entry TLV Stream Hex String>
  }
*/
module.exports = args => {
  const isReference = !!args.bip353_name || !!args.issuer_id || (
    args.service_id !== undefined || args.service_sequence !== undefined
  );

  if (!!args.offer === isReference) {
    throw new Error('ExpectedEitherOfferOrReferenceToEncodeMenuEntry');
  }

  // Exit early when the entry is an offer
  if (!!args.offer) {
    const {encoded} = callOrThrow({
      error: 'ExpectedValidOfferToEncodeMenuEntry',
      method: () => parseOffer({offer: args.offer}),
    });

    // Exit early when the entry is the whole offer
    if (!args.is_without_paths) {
      return encodeTlvStream({
        records: [{type: typeEntryOffer, value: encoded}],
      });
    }

    // An offer without its paths is the offer with its paths record cut out
    const value = withoutRecord({encoded, type: typeOfferPaths}).encoded;

    return encodeTlvStream({
      records: [{value, type: typeEntryOfferWithoutPaths}],
    });
  }

  if (!isKey(args.issuer_id)) {
    throw new Error('ExpectedIssuerIdToEncodeMenuEntryReference');
  }

  if (args.service_id !== undefined && !isServiceId(args.service_id)) {
    throw new Error('ExpectedServiceIdToEncodeMenuEntryReference');
  }

  const hasSequence = args.service_sequence !== undefined;

  if (hasSequence && !isSequence(args.service_sequence)) {
    throw new Error('ExpectedServiceSequenceToEncodeMenuEntryReference');
  }

  // A sequence is only for a reference to a support offer
  if (hasSequence && !args.service_id) {
    throw new Error('ExpectedServiceIdForServiceSequenceOfMenuEntry');
  }

  const reference = [
    {
      type: typeEntryName,
      value: bip353NameAsHex({bip353_name: args.bip353_name}).encoded,
    },
    {type: typeEntryIssuerId, value: args.issuer_id.toLowerCase()},
  ];

  // Exit early when the reference is not to a support offer
  if (!args.service_id) {
    return encodeTlvStream({records: reference});
  }

  const service = reference.concat({
    type: typeEntryServiceId,
    value: args.service_id.toLowerCase(),
  });

  // Exit early when the sequence is zero, since a zero sequence is left out
  if (!hasSequence || !BigInt(args.service_sequence)) {
    return encodeTlvStream({records: service});
  }

  return encodeTlvStream({
    records: service.concat({
      type: typeEntryServiceSequence,
      value: numberAsTruncated({number: args.service_sequence}).encoded,
    }),
  });
};
