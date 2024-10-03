const {Transaction} = require('bitcoinjs-lib');

const {fromHex} = Transaction;
const isUtxoP2wpkh = utxo => utxo.witness_utxo.script_pub.startsWith('0014');
const sumTokens = arr => arr.reduce((sum, n) => sum + n.tokens, 0);
const dummyP2wpkh = [Buffer.alloc(33), Buffer.alloc(72)];
const dummyP2tr = [Buffer.alloc(64)];

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
  const tx = fromHex(unsigned);

  inputs.forEach((input, index) => {
    return tx.setWitness(index, isUtxoP2wpkh(input) ? dummyP2wpkh : dummyP2tr);
  });

  return {rate: fee / tx.virtualSize()};
};
