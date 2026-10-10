const {parseOffer} = require('invoices');

const callOrThrow = require('./call_or_throw');
const {decodeRecords} = require('./../service_records');
const decodeSafeNumber = require('./decode_safe_number');
const {decodeServiceRecord} = require('./../service_records');
const hasUnknownEvenRecord = require('./has_unknown_even_record');
const {hexAsList} = require('./../service_records');
const {knownRecordTypes} = require('./known_record_types');
const {maxKeyIndex} = require('./constants');
const {minPathIdBytes} = require('./constants');
const {recordVersion} = require('./constants');
const {serviceTypes} = require('./../service_records');
const {typeRecordKeyIndex} = require('./constants');
const {typeRecordMaxRequests} = require('./constants');
const {typeRecordMaxUnpaid} = require('./constants');
const {typeRecordOffer} = require('./constants');
const {typeRecordPathIds} = require('./constants');

const asNumber = n => decodeSafeNumber({error, encoded: n.value}).number;
const error = 'ExpectedSafeNumberInSupportRecord';
const findRecord = (records, type) => records.find(n => n.type === type);
const isPathId = n => n.length / 2 >= minPathIdBytes;

/** Decode a support service record

  The record is opened with the record key, which checks it was made by this
  node, and is checked to be a support service record with a version that
  is supported. Unknown odd records are ignored.

  {
    key: <Record Key Hex String>
    record: <Support Service Record Hex String>
  }

  @throws
  <Error>

  @returns
  {
    key_index: <Derived Signing Key Index Number>
    [max_requests_per_hour]: <Maximum Requests Answered Per Hour Number>
    [max_unpaid_invoices_per_hour]: <Maximum Unpaid Invoices Per Hour Number>
    offer: <BOLT 12 Support Offer String>
    path_ids: [<Offer Blinded Path Identifier Hex String>]
  }
*/
module.exports = ({key, record}) => {
  const {data, type, version} = decodeServiceRecord({key, record});

  if (type !== serviceTypes.support) {
    throw new Error('ExpectedSupportServiceRecord');
  }

  // A different version is not compatible with this version
  if (version !== recordVersion) {
    throw new Error('UnsupportedSupportServiceRecordVersion');
  }

  const fields = callOrThrow({
    error: 'ExpectedTlvStreamSupportRecordData',
    method: () => decodeRecords({encoded: data}).records,
  });

  const unknown = hasUnknownEvenRecord({
    known: knownRecordTypes,
    records: fields,
  });

  // Unknown even records cannot be ignored
  if (unknown.is_unknown_even) {
    throw new Error('UnexpectedUnknownRequiredRecordInSupportRecord');
  }

  const offer = findRecord(fields, typeRecordOffer);
  const keyIndex = findRecord(fields, typeRecordKeyIndex);
  const pathIds = findRecord(fields, typeRecordPathIds);
  const maxRequests = findRecord(fields, typeRecordMaxRequests);
  const maxUnpaid = findRecord(fields, typeRecordMaxUnpaid);

  if (!offer || !keyIndex || !pathIds) {
    throw new Error('ExpectedOfferKeyIndexAndPathIdsInSupportRecord');
  }

  // The signing key index is below 2^31, so it is a valid key index
  if (asNumber(keyIndex) > maxKeyIndex) {
    throw new Error('ExpectedKeyIndexBelowMaximumInSupportRecord');
  }

  const ids = hexAsList({encoded: pathIds.value}).items;

  if (!ids.length) {
    throw new Error('ExpectedPathIdsInSupportRecord');
  }

  // A path id that is too short could be guessed
  if (!ids.every(isPathId)) {
    throw new Error('ExpectedPathIdsOfAtLeast16BytesInSupportRecord');
  }

  // The offer is kept as its TLV stream bytes
  const offerString = callOrThrow({
    error: 'ExpectedValidOfferInSupportRecord',
    method: () => parseOffer({encoded: offer.value}).offer,
  });

  // A limit is at least one
  const asLimit = record => {
    if (!asNumber(record)) {
      throw new Error('ExpectedPositiveLimitInSupportRecord');
    }

    return asNumber(record);
  };

  return {
    key_index: asNumber(keyIndex),
    max_requests_per_hour: !maxRequests ? undefined : asLimit(maxRequests),
    max_unpaid_invoices_per_hour: !maxUnpaid ? undefined : asLimit(maxUnpaid),
    offer: offerString,
    path_ids: ids,
  };
};
