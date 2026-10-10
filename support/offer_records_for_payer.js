const {isPoint} = require('tiny-secp256k1');
const {parseOffer} = require('invoices');

const bip353NameAsHex = require('./bip353_name_as_hex');
const {numberAsTruncated} = require('./../service_records');
const {typePayerOfferIssuerId} = require('./constants');
const {typePayerOfferName} = require('./constants');
const {typePayerOfferOffer} = require('./constants');
const {typePayerOfferServiceId} = require('./constants');
const {typePayerOfferServiceSequence} = require('./constants');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isKey = n => isHex(n) && n.length === 66 && isPoint(hexAsBuffer(n));
const isSequence = n => /^\d+$/.test(String(n)) && BigInt(n) < maxSequence;
const isServiceId = n => typeof n === 'string' && /^[0-9a-f]{32}$/i.test(n);
const maxSequence = BigInt('18446744073709551616');

/** Get the records of a payer offer: the whole `offer`, or a reference to
  it at a BIP 353 name, with its issuer id, and for a support offer, its
  service id and nonzero service sequence

  {
    [bip353_name]: <Payer Offer BIP 353 Human Readable Name String>
    [issuer_id]: <Payer Offer Issuer Id Public Key Hex String>
    [offer]: <BOLT 12 Payer Offer String>
    [service_id]: <Payer Support Offer Service Id Hex String>
    [service_sequence]: <Payer Support Offer Service Sequence String>
  }

  @throws
  <Error>

  @returns
  {
    records: [{
      type: <Payer Offer Record Type Number String>
      value: <Payer Offer Record Value Hex String>
    }]
  }
*/
module.exports = args => {
  const hasSequence = args.service_sequence !== undefined;

  // A payer offer can be the whole offer
  if (!!args.offer) {
    const parsed = parseOffer({offer: args.offer});

    if (!parsed.issuer_id) {
      throw new Error('ExpectedOfferWithIssuerIdToEncodePayerOffer');
    }

    return {records: [{type: typePayerOfferOffer, value: parsed.encoded}]};
  }

  if (!isKey(args.issuer_id)) {
    throw new Error('ExpectedIssuerIdToEncodePayerOfferReference');
  }

  if (args.service_id !== undefined && !isServiceId(args.service_id)) {
    throw new Error('ExpectedServiceIdToEncodePayerOfferReference');
  }

  if (hasSequence && !isSequence(args.service_sequence)) {
    throw new Error('ExpectedServiceSequenceToEncodePayerOfferReference');
  }

  // A sequence is only for a reference to a support offer
  if (hasSequence && !args.service_id) {
    throw new Error('ExpectedServiceIdForServiceSequenceOfPayerOffer');
  }

  // Or a reference to the offer at a BIP 353 name
  const reference = [
    {
      type: typePayerOfferName,
      value: bip353NameAsHex({bip353_name: args.bip353_name}).encoded,
    },
    {type: typePayerOfferIssuerId, value: args.issuer_id.toLowerCase()},
  ];

  // Exit early when the reference is not to a support offer
  if (!args.service_id) {
    return {records: reference};
  }

  const service = reference.concat({
    type: typePayerOfferServiceId,
    value: args.service_id.toLowerCase(),
  });

  // Exit early when the sequence is zero, since a zero sequence is left out
  if (!hasSequence || !BigInt(args.service_sequence)) {
    return {records: service};
  }

  return {
    records: service.concat({
      type: typePayerOfferServiceSequence,
      value: numberAsTruncated({number: args.service_sequence}).encoded,
    }),
  };
};
