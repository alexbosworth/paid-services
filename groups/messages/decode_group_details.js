const {decodeBigSize} = require('bolt01');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const isOdd = n => !!(n % 2);
const maxCapacityTokens = BigInt(7e14);
const maxMembersCount = BigInt(650);
const maxFeeRate = BigInt(1e5);
const typeCapacity = '1';
const typeCount = '2';
const typeRate = '3';
const typeVersion = '0';

/** Decode group details

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
    capacity: <Channel Capacity Tokens Number>
    count: <Target Members Count Number>
    rate: <Chain Fee Rate Number>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeGroupDetails');
  }

  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeGroupDetails');
  }

  const versionRecord = findRecord(records, typeVersion);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfGroupDetailsRecords');
  }

  const capacityRecord = findRecord(records, typeCapacity);

  try {
    decodeBigSize({encoded: capacityRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidCapacityRecordNumberInGroupRecords');
  }

  const capacity = decodeBigSize({encoded: capacityRecord.value}).decoded;

  if (BigInt(capacity) > maxCapacityTokens) {
    throw new Error('UnexpectedValueForCapacityInGroupRecords');
  }

  if (isOdd(Number(capacity))) {
    throw new Error('ExpectedEvenChannelCapacityInGroupRecords');
  }

  const countRecord = findRecord(records, typeCount);

  try {
    decodeBigSize({encoded: countRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidCountRecordNumberInGroupRecords');
  }

  const count = decodeBigSize({encoded: countRecord.value}).decoded;

  if (BigInt(count) > maxMembersCount) {
    throw new Error('UnexpectedValueForCountInGroupRecords');
  }

  const rateRecord = findRecord(records, typeRate);

  try {
    decodeBigSize({encoded: rateRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidRateRecordNumberInGroupRecords');
  }

  const rate = decodeBigSize({encoded: rateRecord.value}).decoded;

  if (BigInt(rate) > maxFeeRate) {
    throw new Error('UnexpectedValueForFeeRateInGroupRecords');
  }

  return {
    capacity: Number(capacity),
    count: Number(count),
    rate: Number(rate),
  };
};
