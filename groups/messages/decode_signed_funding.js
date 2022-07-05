const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const typeGroupChannelId = '1';
const typeSignedFunding = '2';
const typeVersion = '0';

/** Decode signed funding records

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
    psbt: <Signed PSBT Hex String>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeSignedFunding');
  }

  const versionRecord = findRecord(records, typeVersion);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfSignedFundingRecords');
  }

  const signedFundingRecord = findRecord(records, typeSignedFunding);

  if (!signedFundingRecord) {
    throw new Error('ExpectedSignedFundingRecordInSignedFunding');
  }

  return {psbt: signedFundingRecord.value};
};
