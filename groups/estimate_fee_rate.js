const {componentsOfTransaction} = require('@alexbosworth/blockchain');
const {sizeOfTransaction} = require('@alexbosworth/blockchain');
const {transactionFromComponents} = require('@alexbosworth/blockchain');

const bufferAsHex = buffer => buffer.toString('hex');
const isUtxoP2wpkh = utxo => utxo.witness_utxo.script_pub.startsWith('0014');
const sumTokens = arr => arr.reduce((sum, n) => sum + n.tokens, 0);
const dummyP2wpkh = [Buffer.alloc(33), Buffer.alloc(72)].map(bufferAsHex);
const dummyP2tr = [Buffer.alloc(64)].map(bufferAsHex);

/** Assuming large ECDSA signatures, determine a chain fee rate for a PSBT

  {
    inputs: [{
      witness_utxo: {
        script_pub: <P2TR or P2WPKH Output Script Hex String>
        tokens: <Input Value Tokens Number>
      }
    }]
    outputs: [{
      tokens: <Output Value Tokens Number>
    }]
    unsigned: <Unsigned Transaction Hex String>
  }

  @returns
  {
    rate: <Estimated Chain Fee Tokens Per VByte Number>
  }
*/
module.exports = ({inputs, outputs, unsigned}) => {
  const fee = sumTokens(inputs.map(n => n.witness_utxo)) - sumTokens(outputs);
  const tx = componentsOfTransaction({transaction: unsigned});

  // Add dummy witnesses to the inputs to estimate the final signed size
  const {transaction} = transactionFromComponents({
    inputs: tx.inputs.map((input, index) => ({
      id: input.id,
      script: input.script,
      sequence: input.sequence,
      vout: input.vout,
      witness: isUtxoP2wpkh(inputs[index]) ? dummyP2wpkh : dummyP2tr,
    })),
    locktime: tx.locktime,
    outputs: tx.outputs,
    version: tx.version,
  });

  return {rate: fee / sizeOfTransaction({transaction}).vsize};
};
