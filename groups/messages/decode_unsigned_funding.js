const {decodePsbt} = require('psbt');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const typeUnsignedFundingPsbt = '1';
const typeVersionRecord = '0';

/** Decode unsigned funding records

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
    psbt: <Unsigned Funding PSBT Hex String>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeUnsignedFundingRecords');
  }

  const versionRecord = findRecord(records, typeVersionRecord);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfUnsignedFundingRecords');
  }

  const fundingRecord = findRecord(records, typeUnsignedFundingPsbt);

  if (!fundingRecord) {
    throw new Error('ExpectedFundingRecordInUnsignedFundingRecords');
  }

  return {psbt: fundingRecord.value};
};
