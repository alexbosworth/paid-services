const {decodeTlvStream} = require('bolt01');

const decodeUtxosRecord = require('./decode_utxos_record');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const typeChange = '2';
const typeFunding = '3';
const typeId = '1';
const typeUtxos = '4';
const typeVersion = '0';

/** Decode pending proposal

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
    funding: <Funding Output Script Hex String>
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
    throw new Error('ExpectedArrayOfRecordsToDecodePendingProposal');
  }

  const versionRecord = findRecord(records, typeVersion);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfGroupPendingProposal');
  }

  const changeRecord = findRecord(records, typeChange);
  const fundingRecord = findRecord(records, typeFunding);

  if (!fundingRecord) {
    throw new Error('ExpectedFundingOutputToDecodePendingProposal');
  }

  const utxosRecord = findRecord(records, typeUtxos);

  if (!utxosRecord) {
    throw new Error('ExpectedUtxosRecordToDecodePendingProposal');
  }

  const {utxos} = decodeUtxosRecord({encoded: utxosRecord.value});

  return {
    utxos,
    change: !!changeRecord ? changeRecord.value : undefined,
    funding: fundingRecord.value,
  };
};
