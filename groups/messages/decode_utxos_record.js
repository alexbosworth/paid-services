const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');
const {Transaction} = require('bitcoinjs-lib');

const findRecord = (records, type) => records.find(n => n.type === type);
const {fromHex} = Transaction;

const expectedTxIdHexLength = 64;
const isP2tr = n => n.startsWith('5120') && n.length === 68;
const isP2wpkh = n => n.startsWith('0014') && n.length === 44;
const maxOutputIndex = BigInt(150000);
const maxTokens = Number.MAX_SAFE_INTEGER;
const utxoTypeNonWitnessUtxo = '0';
const utxoTypeScriptPub = '1';
const utxoTypeTokens = '2';
const utxoTypeTransactionId = '3';
const utxoTypeTransactionVout = '4';

/** Decode a record value that encodes UTXOs details

  {
    encoded: <TLV Serialized UTXO Records Hex String>
  }

  @throws
  <Error>

  @returns
  {
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
module.exports = ({encoded}) => {
  // Make sure the encoded TLV is a valid TLV
  try {
    decodeTlvStream({encoded});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamToDecodeUtxosRecord');
  }

  const utxosRecords = decodeTlvStream({encoded}).records;

  const utxos = utxosRecords.map(({value}) => {
    try {
      decodeTlvStream({encoded: value});
    } catch (err) {
      throw new Error('ExpectedValidTlvStreamForEncodedUtxoRecord');
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

  return {utxos};
};