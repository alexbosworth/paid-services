const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const encodeNumber = n => encodeBigSize({number: n.toString()}).encoded;
const encodeTlv = records => encodeTlvStream({records}).encoded;
const outputsAsHashes = outs => outs.map(n => (n || '').substring(4)).join('');
const utxoTypeNonWitnessUtxo = '0';
const utxoTypeScriptPub = '1';
const utxoTypeTokens = '2';
const utxoTypeTransactionId = '3';
const utxoTypeTransactionVout = '4';
const typeChange = '2';
const typeFunding = '3';
const typeId = '1';
const typeUtxos = '4';

/** Encode fanout proposal into TLV records

  {
    [change]: <Change Output Script Hex String>
    funding: [<P2TR Funding Output Script Hex String>]
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

  @returns
  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }
*/
module.exports = ({change, funding, id, utxos}) => {
  // Encode change output script when present
  const changeRecord = {type: typeChange, value: outputsAsHashes([change])};

  // Encode funding output scripts as hashes
  const fundingRecord = {type: typeFunding, value: outputsAsHashes(funding)};

  // Encode the group id
  const idRecord = {type: typeId, value: id};

  // Encode input details
  const inputRecords = utxos.map((utxo, i) => {
    const records = [
      {
        type: utxoTypeNonWitnessUtxo,
        value: utxo.non_witness_utxo,
      },
      {
        type: utxoTypeScriptPub,
        value: utxo.witness_utxo.script_pub,
      },
      {
        type: utxoTypeTokens,
        value: encodeBigSize({number: utxo.witness_utxo.tokens}).encoded,
      },
      {
        type: utxoTypeTransactionId,
        value: utxo.transaction_id,
      },
      {
        type: utxoTypeTransactionVout,
        value: encodeNumber(utxo.transaction_vout),
      },
    ];

    return {
      type: i.toString(),
      value: encodeTlv(records.filter(n => !!n.value)),
    };
  });

  const utxosRecord = {type: typeUtxos, value: encodeTlv(inputRecords)};

  const records = [changeRecord, fundingRecord, idRecord, utxosRecord];

  return {records: records.filter(n => !!n && !!n.value)};
};
