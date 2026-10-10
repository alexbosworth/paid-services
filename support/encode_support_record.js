const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const callOrThrow = require('./call_or_throw');
const {encodeServiceRecord} = require('./../service_records');
const {listAsHex} = require('./../service_records');
const {maxKeyIndex} = require('./constants');
const {minPathIdBytes} = require('./constants');
const {numberAsTruncated} = require('./../service_records');
const {recordVersion} = require('./constants');
const {serviceTypes} = require('./../service_records');
const {typeRecordKeyIndex} = require('./constants');
const {typeRecordMaxRequests} = require('./constants');
const {typeRecordMaxUnpaid} = require('./constants');
const {typeRecordOffer} = require('./constants');
const {typeRecordPathIds} = require('./constants');

const {isArray} = Array;
const {isSafeInteger} = Number;
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const isKeyIndex = n => isSafeInteger(n) && n >= 0 && n <= maxKeyIndex;
const isLimit = n => n === undefined || (isSafeInteger(n) && n > 0);
const isPathId = n => isHex(n) && n.length / 2 >= minPathIdBytes;
const truncated = number => numberAsTruncated({number}).encoded;

/** Encode a support service record

  The record is a service record of the support service type. Its data is a
  TLV stream of the offer and what is needed to service it.

  {
    key: <Record Key Hex String>
    key_index: <Derived Signing Key Index Number>
    [max_requests_per_hour]: <Maximum Requests Answered Per Hour Number>
    [max_unpaid_invoices_per_hour]: <Maximum Unpaid Invoices Per Hour Number>
    offer: <BOLT 12 Support Offer String>
    path_ids: [<Offer Blinded Path Identifier Hex String>]
    record_key_index: <Record Key Index Number>
  }

  @throws
  <Error>

  @returns
  {
    record: <Support Service Record Hex String>
  }
*/
module.exports = args => {
  if (!isKeyIndex(args.key_index)) {
    throw new Error('ExpectedKeyIndexToEncodeSupportRecord');
  }

  if (!isLimit(args.max_requests_per_hour)) {
    throw new Error('ExpectedPositiveMaxRequestsToEncodeSupportRecord');
  }

  if (!isLimit(args.max_unpaid_invoices_per_hour)) {
    throw new Error('ExpectedPositiveMaxUnpaidToEncodeSupportRecord');
  }

  if (!args.offer || typeof args.offer !== 'string') {
    throw new Error('ExpectedOfferToEncodeSupportRecord');
  }

  if (!isArray(args.path_ids) || !args.path_ids.length) {
    throw new Error('ExpectedPathIdsToEncodeSupportRecord');
  }

  // Path ids are at least 16 random bytes, so they cannot be guessed
  if (!args.path_ids.every(isPathId)) {
    throw new Error('ExpectedPathIdsOfAtLeast16BytesToEncodeSupportRecord');
  }

  // The offer is kept as its TLV stream bytes
  const offer = callOrThrow({
    error: 'ExpectedValidOfferToEncodeSupportRecord',
    method: () => parseOffer({offer: args.offer}).encoded,
  });

  // A limit is left out when there is no limit
  const limit = (type, max) => !max ? null : {type, value: truncated(max)};

  const records = [
    {type: typeRecordOffer, value: offer},
    {type: typeRecordKeyIndex, value: truncated(args.key_index)},
    {
      type: typeRecordPathIds,
      value: listAsHex({items: args.path_ids}).encoded,
    },
    limit(typeRecordMaxUnpaid, args.max_unpaid_invoices_per_hour),
    limit(typeRecordMaxRequests, args.max_requests_per_hour),
  ];

  const data = encodeTlvStream({records: records.filter(n => !!n)});

  return encodeServiceRecord({
    data: data.encoded,
    key: args.key,
    record_key_index: args.record_key_index,
    type: serviceTypes.support,
    version: recordVersion,
  });
};
