const {isPoint} = require('tiny-secp256k1');
const {parseOffer} = require('invoices');

const {decodeRecords} = require('./../service_records');
const hasUnknownEvenRecord = require('./has_unknown_even_record');
const hexAsBip353Name = require('./hex_as_bip353_name');
const {knownEntryTypes} = require('./known_record_types');
const {truncatedAsNumber} = require('./../service_records');
const {typeEntryIssuerId} = require('./constants');
const {typeEntryName} = require('./constants');
const {typeEntryOffer} = require('./constants');
const {typeEntryOfferWithoutPaths} = require('./constants');
const {typeEntryServiceId} = require('./constants');
const {typeEntryServiceSequence} = require('./constants');
const {typeOfferPaths} = require('./constants');

const findRecord = (records, type) => records.find(n => n.type === type);
const formsPerEntry = 1;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const lengthIdHex = 32;
const lengthKeyHex = 66;

/** Decode an entry of a support menu: a whole offer, an offer of the
  recipient without its paths, or a reference to an offer at a BIP 353 name

  Nothing is returned for an entry that cannot be read, that has an unknown
  even record, or that is not exactly one of those. An offer without its
  paths is given as its TLV stream, for the reader to give the paths of the
  support offer.

  {
    encoded: <Menu Entry TLV Stream Hex String>
  }

  @returns
  {
    [offer]: <BOLT 12 Offer String>
    [reference]: {
      bip353_name: <Offer BIP 353 Human Readable Name String>
      issuer_id: <Offer Issuer Id Public Key Hex String>
      [service_id]: <Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }
    [without_paths]: <Offer TLV Stream Without Paths Hex String>
  }
*/
module.exports = ({encoded}) => {
  try {
    const {records} = decodeRecords({encoded});

    const unknown = hasUnknownEvenRecord({records, known: knownEntryTypes});

    // An entry with an unknown even record is left out
    if (unknown.is_unknown_even) {
      return {};
    }

    const issuerId = findRecord(records, typeEntryIssuerId);
    const nameRecord = findRecord(records, typeEntryName);
    const offer = findRecord(records, typeEntryOffer);
    const serviceId = findRecord(records, typeEntryServiceId);
    const sequence = findRecord(records, typeEntryServiceSequence);
    const withoutPaths = findRecord(records, typeEntryOfferWithoutPaths);

    const isReference = !!nameRecord || !!issuerId || !!serviceId || !!sequence;

    const forms = [!!offer, !!withoutPaths, isReference].filter(n => !!n);

    // An entry is exactly one of its forms
    if (forms.length !== formsPerEntry) {
      return {};
    }

    // Exit early when the entry is the whole offer
    if (!!offer) {
      return {offer: parseOffer({encoded: offer.value}).offer};
    }

    // Exit early when the entry is an offer without its paths
    if (!!withoutPaths) {
      const fields = decodeRecords({encoded: withoutPaths.value}).records;

      if (!!findRecord(fields, typeOfferPaths)) {
        return {};
      }

      return {without_paths: withoutPaths.value};
    }

    if (!nameRecord || !issuerId) {
      return {};
    }

    if (issuerId.value.length !== lengthKeyHex) {
      return {};
    }

    if (!isPoint(hexAsBuffer(issuerId.value))) {
      return {};
    }

    if (!!serviceId && serviceId.value.length !== lengthIdHex) {
      return {};
    }

    // A sequence is only for a reference to a support offer
    if (!!sequence && !serviceId) {
      return {};
    }

    // A sequence is a minimal tu64
    const sequenceOf = ({value}) => truncatedAsNumber({encoded: value}).number;

    const lowest = !sequence ? undefined : sequenceOf(sequence);

    const {bip353_name} = hexAsBip353Name({encoded: nameRecord.value});

    return {
      reference: {
        bip353_name,
        issuer_id: issuerId.value,
        ...(!serviceId ? {} : {service_id: serviceId.value}),
        ...(!lowest || lowest === '0' ? {} : {service_sequence: lowest}),
      },
    };
  } catch (err) {
    return {};
  }
};
