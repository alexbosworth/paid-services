const {decodeBigSize} = require('bolt01');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const maxMembersCount = BigInt(420);
const maxFeeRate = BigInt(1e5);
const maxTokens = BigInt(7e14);
const minMembersCount = BigInt(3);
const typeCount = '2';
const typeRate = '3';
const typeSize = '1';
const typeVersion = '0';
const version = '1';

/** Decode fanout group details

  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    capacity: <Output Size Tokens Number>
    count: <Target Members Count Number>
    rate: <Chain Fee Rate Number>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeFanoutGroupDetails');
  }

  const versionRecord = findRecord(records, typeVersion);

  if (!versionRecord) {
    throw new Error('ExpectedVersionOfFanoutGroupDetailsRecords');
  }

  try {
    decodeBigSize({encoded: versionRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidVersionNumberInFanoutGroupRecords');
  }

  if (decodeBigSize({encoded: versionRecord.value}).decoded !== version) {
    throw new Error('UnsupportedFanoutGroupVersion');
  }

  const capacityRecord = findRecord(records, typeSize);

  try {
    decodeBigSize({encoded: capacityRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidSizeRecordNumberInFanoutGroupRecords');
  }

  const capacity = decodeBigSize({encoded: capacityRecord.value}).decoded;

  if (BigInt(capacity) > maxTokens) {
    throw new Error('UnexpectedValueForSizeInFanoutGroupRecords');
  }

  const countRecord = findRecord(records, typeCount);

  try {
    decodeBigSize({encoded: countRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidCountRecordNumberInFanoutGroupRecords');
  }

  const count = decodeBigSize({encoded: countRecord.value}).decoded;

  if (BigInt(count) > maxMembersCount) {
    throw new Error('UnexpectedHighValueForCountInFanoutGroupRecords');
  }

  if (BigInt(count) < minMembersCount) {
    throw new Error('ExpectedHigherMembersCountInFanoutGroupDetails');
  }

  const rateRecord = findRecord(records, typeRate);

  try {
    decodeBigSize({encoded: rateRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidRateRecordNumberInFanoutGroupRecords');
  }

  const rate = decodeBigSize({encoded: rateRecord.value}).decoded;

  if (BigInt(rate) > maxFeeRate) {
    throw new Error('UnexpectedValueForFeeRateInFanoutGroupRecords');
  }

  return {
    capacity: Number(capacity),
    count: Number(count),
    rate: Number(rate),
  };
};
