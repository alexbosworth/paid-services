const {decodeBigSize} = require('bolt01');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const maxCount = BigInt(25000);
const typeSignedCountRecord = '1';
const typeVersionRecord = '0';

/** Decode signed group members records

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
    count: <Signed Count Number>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeSignedRecords');
  }

  const versionRecord = findRecord(records, typeVersionRecord);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfGroupSignedRecords');
  }

  const signedCountRecord = findRecord(records, typeSignedCountRecord);

  if (!signedCountRecord) {
    throw new Error('ExpectedSignedCountRecordWhenDecodingGroupSignedRecords');
  }

  try {
    decodeBigSize({encoded: signedCountRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidSignedCountRecordNumberInSignedRecords');
  }

  const {decoded} = decodeBigSize({encoded: signedCountRecord.value});

  if (BigInt(decoded) > maxCount) {
    throw new Error('UnexpectedValueForSignedCountInGroupSignedRecords');
  }

  return {count: Number(decoded)};
};
