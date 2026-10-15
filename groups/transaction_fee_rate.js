const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');

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
  const {outputs} = componentsOfTransaction({transaction});

  const fee = inputsValue - sumOf(outputs.map(n => n.tokens));

  return {rate: fee / sizeOfTransaction({transaction}).vsize};
};
