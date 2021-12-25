const {Transaction} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const {fromHex} = Transaction;
const txIdAsHash = id => Buffer.from(id, 'hex').reverse();

/** Find the witness script in the list of transactions

  {
    closing_tx_id: <Close Channel Transaction Id Hex String>
    transactions: [{
      id: <Transaction Id Hex String>
      [transaction]: <Raw Transaction hex String>
    }]
    transaction_id: <Original Channel Transaction Id Hex String>
    transaction_vout: <Original Channel Transaction Output Index Number>
  }

  @returns
  {
    script: <Witness Script Hex Encoded String>
  }
*/
module.exports = args => {
  const closing = args.transactions.find(tx => tx.id === args.closing_tx_id);

  if (!closing || !closing.transaction) {
    throw new Error('FailedToFindClosingTransactionToReplace');
  }

  const [{hash, index, witness}, other] = fromHex(closing.transaction).ins;

  if (!!other) {
    throw new Error('ExpectedSingleInputForClosingTransaction');
  }

  // The funding outpoint is spent in the closing transaction
  if (index !== args.transaction_vout) {
    throw new Error('ExpectedClosingTxSpendsFundingOutputIndex');
  }

  if (!hash.equals(txIdAsHash(args.transaction_id))) {
    throw new Error('ExpectedCloseSpendingOpenTransactionId');
  }

  // The witness script is the final witness stack element
  const [script] = witness.slice().reverse();

  return {script: bufferAsHex(script)};
};
