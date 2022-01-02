const findDescriptionRecord = records => records.find(n => n.type === '2');
const findIdRecord = records => records.find(n => n.type === '1');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');
const {isArray} = Array;

/** Decode a basic trade

  1: <Trade Id>
  2: <Trade Description>

  {
    records: [{
      type: <Basic Trade Record Type Number String>
      value: <Value Hex Encoded String>
    }]
  }

  @returns
  {
    description: <Trade Description String>
    id: <Trade Id Hex String>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeBasicTrade');
  }

  const descriptionRecord = findDescriptionRecord(records);

  if (!descriptionRecord) {
    throw new Error('ExpectedDescriptionRecordToDecodeBasicTrade');
  }

  const idRecord = findIdRecord(records);

  if (!idRecord) {
    throw new Error('ExpectedIdRecordToDecodeBasicTradeDetails');
  }

  return {
    description: hexAsUtf8(descriptionRecord.value),
    id: idRecord.value,
  };
};
