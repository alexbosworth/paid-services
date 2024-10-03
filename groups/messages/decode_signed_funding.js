const {decodePsbt} = require('psbt');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const nonEmpty = arr => arr.filter(n => !!n);
const typeGroupChannelId = '1';
const typeSignedFunding = '2';
const typeVersion = '0';

/** Decode signed funding records

  {
    ecp: <ECPair Library Object>
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    p2tr: [<P2TR Key Spend Signature Hex String>]
    psbt: <Signed PSBT Hex String>
  }
*/
module.exports = ({ecp, records}) => {
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

  try {
    decodePsbt({ecp, psbt: signedFundingRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidPsbtRecordInSignedFunding');
  }

  const {inputs} = decodePsbt({ecp, psbt: signedFundingRecord.value});

  return {
    p2tr: nonEmpty(inputs.map(input => input.taproot_key_spend_sig)),
    psbt: signedFundingRecord.value,
  };
};
