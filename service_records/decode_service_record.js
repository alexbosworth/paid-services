const decodeRecords = require('./decode_records');
const hexAsVersion = require('./hex_as_version');
const knownTypes = require('./known_types').record;
const openSealedData = require('./open_sealed_data');
const readRecordKeyIndex = require('./read_record_key_index');
const {recordPrefix} = require('./constants');
const sealKeyForSalt = require('./seal_key_for_salt');
const truncatedAsNumber = require('./truncated_as_number');
const {typeSalt} = require('./constants');
const {typeSealedData} = require('./constants');
const {typeServiceType} = require('./constants');
const {typeVersion} = require('./constants');
const withoutRecord = require('./without_record');

const bufferAsHex = buffer => buffer.toString('hex');
const byteLength = hex => hex.length / 2;
const isEven = type => !(BigInt(type) % BigInt(2));
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const isUnknownEven = n => !knownTypes.includes(n.type) && isEven(n.type);
const lengthKeyBytes = 32;

/** Decode a service record, opening its sealed data with the record key of
  its record key index, which checks it was made with that key and unchanged

  {
    key: <Record Key Hex String>
    record: <Service Record Hex String>
  }

  @throws
  <Error>

  @returns
  {
    data: <Service Data TLV Stream Hex String>
    record_key_index: <Record Key Index Number>
    type: <Service Type Number String>
    version: <Service Version Number>
  }
*/
module.exports = ({key, record}) => {
  if (!isHex(key) || byteLength(key) !== lengthKeyBytes) {
    throw new Error('ExpectedRecordKeyToDecodeServiceRecord');
  }

  if (!isHex(record)) {
    throw new Error('ExpectedHexServiceRecordToDecode');
  }

  if (!record.toLowerCase().startsWith(recordPrefix)) {
    throw new Error('ExpectedPaidServicesPrefixForServiceRecord');
  }

  // The key index and the framing of the record are checked first
  const keyIndex = readRecordKeyIndex({record}).index;

  const {records} = decodeRecords({
    encoded: record.slice(recordPrefix.length),
  });

  const salt = records.find(n => n.type === typeSalt);
  const sealed = records.find(n => n.type === typeSealedData);

  // The record was sealed with its own key, derived with its salt
  const sealKey = sealKeyForSalt({key, salt: salt.value}).key;

  // The associated data is the record as it was received, with only the
  // sealed data cut out, including records that are not known
  const {encoded} = withoutRecord({
    encoded: record.slice(recordPrefix.length),
    type: typeSealedData,
  });

  // The data only opens when the record was made with this key, unchanged
  const {data} = openSealedData({
    associated: recordPrefix + encoded,
    key: sealKey,
    sealed: sealed.value,
  });

  // Unknown even records cannot be ignored
  if (!!records.find(isUnknownEven)) {
    throw new Error('UnexpectedUnknownRequiredRecordInServiceRecord');
  }

  const serviceType = records.find(n => n.type === typeServiceType);
  const version = records.find(n => n.type === typeVersion);

  if (!serviceType || !version) {
    throw new Error('ExpectedTypeAndVersionInServiceRecord');
  }

  // Exit early when the version is not a number
  try {
    hexAsVersion({encoded: version.value});
  } catch (err) {
    throw new Error('ExpectedVersionNumberInServiceRecord');
  }

  return {
    data: bufferAsHex(data),
    record_key_index: keyIndex,
    type: truncatedAsNumber({encoded: serviceType.value}).number,
    version: hexAsVersion({encoded: version.value}).version,
  };
};
