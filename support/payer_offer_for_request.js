const {parseInvoiceRequest} = require('invoices');
const {verifySchnorr} = require('tiny-secp256k1');

const {decodeRecords} = require('./../service_records');
const knownTypes = require('./payer_offer_types');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const payerOfferSigner = require('./payer_offer_signer');
const signaturePreimage = require('./payer_offer_signature_preimage');
const {truncatedAsNumber} = require('./../service_records');
const {typePayerOffer} = require('./constants');
const {typePayerOfferExpiry} = require('./constants');
const {typePayerOfferIssuerId} = require('./constants');
const {typePayerOfferName} = require('./constants');
const {typePayerOfferOffer} = require('./constants');
const {typePayerOfferServiceId} = require('./constants');
const {typePayerOfferServiceSequence} = require('./constants');
const {typePayerOfferSignature} = require('./constants');
const {withoutRecord} = require('./../service_records');

const asDate = ms => new Date(Number(ms)).toISOString();
const cap = ms => ms < maxDateMs ? ms : maxDateMs;
const expiryMs = n => BigInt(numberOf(n)) * BigInt(msPerSecond);
const findRecord = (records, type) => records.find(n => n.type === type);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isEven = type => !(BigInt(type) % BigInt(2));
const isPast = ms => BigInt(Date.now()) > ms;
const isUnknownEven = n => !knownTypes.includes(n.type) && isEven(n.type);
const lengthSignatureHex = 128;
const maxDateMs = BigInt(8.64e15);
const msPerSecond = 1e3;
const numberOf = ({value}) => truncatedAsNumber({encoded: value}).number;

/** Get the payer offer of an invoice request, when it has a valid one

  A payer offer is the whole offer, or a reference to it at a BIP 353 name,
  signed by its offer issuer id for the network of the support offer that
  the request pays and the payer id of the request. One that cannot be read,
  whose signature is not valid, whose expiry has passed, or whose whole offer
  has expired or cannot be paid on that network is ignored, and the request
  is still a request to pay. An expiry past the latest date that can be
  represented is given as that date.

  Use a reference only once the offer found at its name is checked with
  `verifyOfferReference`. A payer offer is never paid by itself.

  {
    request: <Invoice Request TLV Stream Hex String>
  }

  @returns
  {
    [expires_at]: <Payer Offer Expires At ISO 8601 Date String>
    [payer_offer]: <BOLT 12 Payer Offer String>
    [payer_offer_reference]: {
      bip353_name: <Payer Offer BIP 353 Human Readable Name String>
      issuer_id: <Payer Offer Issuer Id Public Key Hex String>
      network: <Paid Support Offer Bitcoin Network Name String>
      [service_id]: <Payer Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }
  }
*/
module.exports = ({request}) => {
  try {
    const parsed = parseInvoiceRequest({encoded: request});

    const {records} = decodeRecords({encoded: request});

    const record = findRecord(records, typePayerOffer);

    // Exit early when there is no payer offer
    if (!record) {
      return {};
    }

    const fields = decodeRecords({encoded: record.value}).records;

    // A payer offer with an unknown even record cannot be used
    if (!!fields.filter(isUnknownEven).length) {
      return {};
    }

    const offerRecord = findRecord(fields, typePayerOfferOffer);
    const issuerRecord = findRecord(fields, typePayerOfferIssuerId);
    const nameRecord = findRecord(fields, typePayerOfferName);
    const expiryRecord = findRecord(fields, typePayerOfferExpiry);
    const serviceRecord = findRecord(fields, typePayerOfferServiceId);
    const sequenceRecord = findRecord(fields, typePayerOfferServiceSequence);
    const signature = findRecord(fields, typePayerOfferSignature);

    // An expiry is a minimal tu64 count of seconds from the UNIX epoch, and
    // can be later than the latest date that can be represented
    const expiry = !expiryRecord ? undefined : expiryMs(expiryRecord);

    // A payer offer whose expiry has passed is ignored
    if (expiry !== undefined && isPast(expiry)) {
      return {};
    }

    // An expiry past the latest date is given as the latest date
    const expiresAt = expiry === undefined ? undefined : asDate(cap(expiry));

    if (!signature || signature.value.length !== lengthSignatureHex) {
      return {};
    }

    const referenceRecords = [
      issuerRecord,
      nameRecord,
      sequenceRecord,
      serviceRecord,
    ];

    const isReference = !!referenceRecords.filter(n => !!n).length;

    // A payer offer is either the whole offer or a reference to it
    if (!!offerRecord === isReference) {
      return {};
    }

    // The network of the support offer that the request pays
    const {network} = offerBitcoinNetwork({offer: parsed.offer});

    const payer = payerOfferSigner({
      network,
      issuer: issuerRecord,
      name: nameRecord,
      offer: offerRecord,
      sequence: sequenceRecord,
      service: serviceRecord,
    });

    // Only an offer with an issuer id can be signed for
    if (!payer.issuer_id) {
      return {};
    }

    // The signature covers the payer offer as it was received
    const unsigned = withoutRecord({
      encoded: record.value,
      type: typePayerOfferSignature,
    });

    const {hash} = signaturePreimage({
      network,
      payer_id: parsed.payer_id,
      unsigned: unsigned.encoded,
    });

    const isValid = verifySchnorr(
      hexAsBuffer(hash),
      hexAsBuffer(payer.issuer_id).subarray(1),
      hexAsBuffer(signature.value)
    );

    // Exit early when the payer offer is not signed by its issuer id
    if (!isValid) {
      return {};
    }

    const expires = !expiresAt ? {} : {expires_at: expiresAt};

    if (!!payer.payer_offer) {
      return {...expires, payer_offer: payer.payer_offer};
    }

    return {...expires, payer_offer_reference: payer.payer_offer_reference};
  } catch (err) {
    return {};
  }
};
