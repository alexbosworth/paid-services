const findRecord = (records, type) => records.find(n => n.type === type);
const inIdFromPartnersValue = n => n.slice(0, 66);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const outIdFromPartnersValue = n => n.slice(66);
const {isArray} = Array;
const typePartnersRecord = '1';
const typeVersionRecord = '0';

/** Decode group channel partners records

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
    inbound: <Inbound Channel Partner Public Key Hex String>
    outbound: <Outbound Channel Partner Public Key Hex String>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodePartnersRecords');
  }

  const versionRecord = findRecord(records, typeVersionRecord);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfGroupChannelPartnerRecords');
  }

  const partnersRecord = findRecord(records, typePartnersRecord);

  if (!partnersRecord) {
    throw new Error('ExpectedPartnersRecordWhenDecodingPartnersRecords');
  }

  const inId = inIdFromPartnersValue(partnersRecord.value);

  if (!isPublicKey(inId)) {
    throw new Error('ExpectedInPartnerIdentityPublicKeyInPartnersRecords');
  }

  const outId = outIdFromPartnersValue(partnersRecord.value);

  if (!isPublicKey(outId)) {
    throw new Error('ExpectedOutPartnerIdentityPublicKeyInPartnersRecords');
  }

  return {inbound: inId, outbound: outId};
};
