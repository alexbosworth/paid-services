const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');
const {Transaction} = require('bitcoinjs-lib');

const expectedTxIdHexLength = 64;
const findRecord = (records, type) => records.find(n => n.type === type);
const {fromHex} = Transaction;
const {isArray} = Array;
const isP2tr = n => n.startsWith('5120') && n.length === 68;
const isP2wpkh = n => n.startsWith('0014') && n.length === 44;
const maxOutputIndex = BigInt(150000);
const maxTokens = Number.MAX_SAFE_INTEGER;
const utxoTypeNonWitnessUtxo = '0';
const utxoTypeScriptPub = '1';
const utxoTypeTokens = '2';
const utxoTypeTransactionId = '3';
const utxoTypeTransactionVout = '4';
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

  try {
    decodeTlvStream({encoded: utxosRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamToDecodePendingProposal');
  }

  const utxosRecords = decodeTlvStream({encoded: utxosRecord.value}).records;

  const utxos = utxosRecords.map(({value}) => {
    try {
      decodeTlvStream({encoded: value});
    } catch (err) {
      throw new Error('ExpectedValidTlvStreamForEncodedPendingProposalUtxo');
    }

    const utxoRecords = decodeTlvStream({encoded: value}).records;

    const nonWitnessUtxo = findRecord(utxoRecords, utxoTypeNonWitnessUtxo);

    if (!!nonWitnessUtxo) {
      try {
        fromHex(nonWitnessUtxo.value);
      } catch (err) {
        throw new Error('ExpectedValidTransactionInPendingWitnessUtxo');
      }
    }

    const transactionId = findRecord(utxoRecords, utxoTypeTransactionId);

    if (!transactionId) {
      throw new Error('ExpectedUtxoTransactionidInPendingProposalTxId');
    }

    if (transactionId.value.length !== expectedTxIdHexLength) {
      throw new Error('UnexpectedLengthOfTxIdInPendingProposal');
    }

    const transactionVout = findRecord(utxoRecords, utxoTypeTransactionVout);

    if (!transactionVout) {
      throw new Error('ExpectedUtxoTransactionVoutInPendingProposal');
    }

    try {
      decodeBigSize({encoded: transactionVout.value});
    } catch (err) {
      throw new Error('ExpectedNumericTransactionOutputIndexInPending');
    }

    const txVout = decodeBigSize({encoded: transactionVout.value}).decoded;

    if (BigInt(txVout) > maxOutputIndex) {
      throw new Error('ExpecteSmallerOutputIndexInPendingProposal');
    }

    const scriptPub = findRecord(utxoRecords, utxoTypeScriptPub);

    if (!scriptPub) {
      throw new Error('ExpectedWitnessScriptPubInPendingProposal');
    }

    if (!isP2tr(scriptPub.value) && !isP2wpkh(scriptPub.value)) {
      throw new Error('UnsupportedUtxoTypeForPendingProposal');
    }

    const tokensRecord = findRecord(utxoRecords, utxoTypeTokens);

    if (!tokensRecord) {
      throw new Error('ExpectedUtxoTokensInPendingProposal');
    }

    try {
      decodeBigSize({encoded: tokensRecord.value});
    } catch (err) {
      throw new Error('ExpectedNumericTokensValueInPendingProposal');
    }

    const tokens = decodeBigSize({encoded: tokensRecord.value}).decoded;

    if (BigInt(tokens) > maxTokens) {
      throw new Error('ExpectedSmallerTokensValueInPendingProposal');
    }

    return {
      non_witness_utxo: !!nonWitnessUtxo ? nonWitnessUtxo.value : undefined,
      transaction_id: transactionId.value,
      transaction_vout: Number(txVout),
      witness_utxo: {script_pub: scriptPub.value, tokens: Number(tokens)},
    };
  });

  try {
    decodeTlvStream({encoded: fundingRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForFundingOutputsToDecodePendingProposal');
  }

  const funding = decodeTlvStream({encoded: fundingRecord.value}).records.map(({value}) => value);

  return {funding, utxos, change: changeRecord.value};
};
