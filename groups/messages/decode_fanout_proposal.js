const decodeUtxosRecord = require('./decode_utxos_record');

const findRecord = (records, type) => records.find(n => n.type === type);
const hashAsOutput = hash => `5120${hash}`;
const {isArray} = Array;
const isHashes = value => value.length % 64 === 0;
const maxHashesLength = 64 * 2000;
const splitHashes = hashes => hashes.match(/.{1,64}/g);
const typeChange = '2';
const typeFunding = '3';
const typeId = '1';
const typeUtxos = '4';
const typeVersion = '0';

/** Decode proposed fanout participation

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
    [change]: <Change Output Script Hex String>
    funding: [<Funding Output Script Hex String>]
    utxos: [{
      [non_witness_utxo]: <Non Witness Transaction Hex String>
      transaction_id: <Transaction Id Hex String>
      transaction_vout: <Transaction Output Index Number>
      witness_utxo: {
        script_pub: <UTXO Output Script Hex String>
        tokens: <UTXO Tokens Value Number>
      }
    }]
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeFanoutProposal');
  }

  const versionRecord = findRecord(records, typeVersion);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfGroupFanoutProposal');
  }

  const changeRecord = findRecord(records, typeChange);

  if (!!changeRecord && !isHashes(changeRecord.value)) {
    throw new Error('ExpectedHashValueForChangeRecordToDecodeFanoutProposal');
  }

  const fundingRecord = findRecord(records, typeFunding);

  if (!fundingRecord) {
    throw new Error('ExpectedFundingOutputsRecordToDecodeFanoutProposal');
  }

  if (fundingRecord.value.length > maxHashesLength) {
    throw new Error('ExpectedFewerFundingHashesToDecodeFanoutProposal');
  }

  if (!isHashes(fundingRecord.value)) {
    throw new Error('ExpectedConcatenatedListOfHashesForFanoutProposal');
  }

  const utxosRecord = findRecord(records, typeUtxos);

  if (!utxosRecord) {
    throw new Error('ExpectedUtxosRecordToDecodeFanoutProposal');
  }

  return {
    change: !changeRecord ? undefined : hashAsOutput(changeRecord.value),
    funding: splitHashes(fundingRecord.value).map(hashAsOutput),
    utxos: decodeUtxosRecord({encoded: utxosRecord.value}).utxos,
  };
};
