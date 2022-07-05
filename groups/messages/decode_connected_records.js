const {decodeBigSize} = require('bolt01');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const maxConnectedCount = BigInt(25000);
const typeConnectedCountRecord = '1';
const typeVersionRecord = '0';

/** Decode connected group members records

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
    count: <Connected Count Number>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeConnectedRecords');
  }

  const versionRecord = findRecord(records, typeVersionRecord);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfGroupConnectedRecords');
  }

  const connectedRecord = findRecord(records, typeConnectedCountRecord);

  if (!connectedRecord) {
    throw new Error('ExpectedConnectedRecordWhenDecodingConnectedRecords');
  }

  try {
    decodeBigSize({encoded: connectedRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidConnectedRecordNumberInConnectedRecords');
  }

  const {decoded} = decodeBigSize({encoded: connectedRecord.value});

  if (BigInt(decoded) > maxConnectedCount) {
    throw new Error('UnexpectedValueForConnectedCountInConnectedRecords');
  }

  return {count: Number(decoded)};
};
