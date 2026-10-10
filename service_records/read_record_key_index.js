const decodeRecords = require('./decode_records');
const {lengthSaltBytes} = require('./constants');
const {lengthTagBytes} = require('./constants');
const {maxRecordKeyIndex} = require('./constants');
const {recordPrefix} = require('./constants');
const truncatedAsNumber = require('./truncated_as_number');
const {typeKeyIndex} = require('./constants');
const {typeSalt} = require('./constants');
const {typeSealedData} = require('./constants');
const {typeServiceType} = require('./constants');
const {typeVersion} = require('./constants');

const byteLength = hex => hex.length / 2;
const findRecord = (records, type) => records.find(n => n.type === type);
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);

/** Read the index of the record key that a service record was sealed with

  Everything that can be checked without a key is checked here: the prefix,
  the TLV stream, the records a record has to have, the length of the salt,
  and that the index is below 2^31. Check that the index is one that is
  accepted before deriving its key.

  {
    record: <Service Record Hex String>
  }

  @throws
  <Error>

  @returns
  {
    index: <Record Key Index Number>
  }
*/
module.exports = ({record}) => {
  if (!isHex(record)) {
    throw new Error('ExpectedHexServiceRecordToReadKeyIndex');
  }

  if (!record.toLowerCase().startsWith(recordPrefix)) {
    throw new Error('ExpectedPaidServicesPrefixForServiceRecord');
  }

  const encoded = record.slice(recordPrefix.length);

  // Exit early when the records cannot be decoded
  try {
    decodeRecords({encoded});
  } catch (err) {
    throw new Error('ExpectedTlvStreamServiceRecordToDecode');
  }

  const {records} = decodeRecords({encoded});

  const keyIndex = findRecord(records, typeKeyIndex);
  const salt = findRecord(records, typeSalt);
  const sealed = findRecord(records, typeSealedData);
  const serviceType = findRecord(records, typeServiceType);
  const version = findRecord(records, typeVersion);

  if (!serviceType || !version) {
    throw new Error('ExpectedTypeAndVersionInServiceRecord');
  }

  if (!keyIndex) {
    throw new Error('ExpectedRecordKeyIndexInServiceRecord');
  }

  if (!salt || byteLength(salt.value) !== lengthSaltBytes) {
    throw new Error('ExpectedSaltInServiceRecord');
  }

  if (!sealed || byteLength(sealed.value) < lengthTagBytes) {
    throw new Error('ExpectedSealedDataInServiceRecord');
  }

  // Exit early when the index is not a number
  try {
    truncatedAsNumber({encoded: keyIndex.value});
  } catch (err) {
    throw new Error('ExpectedRecordKeyIndexNumberInServiceRecord');
  }

  const {number} = truncatedAsNumber({encoded: keyIndex.value});

  // An index is compared as a big number before it is made a number
  if (BigInt(number) > BigInt(maxRecordKeyIndex)) {
    throw new Error('ExpectedRecordKeyIndexBelowMaximumInServiceRecord');
  }

  const index = Number(number);

  return {index};
};
