const {Transaction} = require('bitcoinjs-lib');

const {fromHex} = Transaction;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);

/** Given a transaction and inputs metadata, derive transaction chain fee rate

  {
    inputs: [{
      witness_utxo: {
        tokens: <Input Value Tokens Number>
      }
    }]
    transaction: <Signed Final Transaction Hex String>
  }

  @returns
  {
    rate: <Chain Fee Tokens Per VByte Number>
  }
*/
module.exports = ({inputs, transaction}) => {
  const inputsValue = sumOf(inputs.map(n => n.witness_utxo.tokens));
  const tx = fromHex(transaction);

  const fee = inputsValue - sumOf(tx.outs.map(n => n.value));

  return {rate: fee / tx.virtualSize()};
};
