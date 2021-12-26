const {script} = require('bitcoinjs-lib');
const {Transaction} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const {decompile} = script;
const encodeSig = (n, flag) => Buffer.concat([Buffer.from(n, 'hex'), flag]);
const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isBuffer} = Buffer;
const nullDummyStackItem = Buffer.alloc(0);
const signatureFlag = Buffer.from([Transaction.SIGHASH_ALL]);

/** Add signaturess to a capacity replacement transaction

  {
    [add_funds_vin]: <Add Funds Input Index>
    [add_funds_public_key]: <Add Funds Transit Public Key Hex String>
    [add_funds_signature]: <Add Funds Signature Hex String>
    local_public_key: <Local MultiSig Public Key Hex String>
    local_signature: <Local Replacement Signature Hex String>
    funding_spend_vin: <Funding Transaction Output Spend Input Index Number>
    remote_signature: <Peer Signature Hex String>
    transaction: <Unsigned Replacement Transaction Hex String>
    witness_script: <Funding Witness Script Hex Encoded String>
  }

  @returns
  {
    transaction: <Fully Signed Transaction Hex String>
  }
*/
module.exports = args => {
  const funding = hexAsBuffer(args.witness_script);
  const tx = fromHex(args.transaction);

  const keys = decompile(funding).filter(isBuffer).map(bufferAsHex);

  const signatures = [,];

  // Find the indices to place the signatures
  const localKeyIndex = keys.findIndex(n => n === args.local_public_key);
  const remoteKeyIndex = keys.findIndex(n => n !== args.local_public_key);

  // Add the local signature to the funding witness stack
  signatures[localKeyIndex] = encodeSig(args.local_signature, signatureFlag);

  // Add the remote signature to the funding witness stack
  signatures[remoteKeyIndex] = encodeSig(args.remote_signature, signatureFlag);

  const witness = []
    .concat([nullDummyStackItem])
    .concat(signatures)
    .concat([funding]);

  // Fill in the witness stack including the close spend
  tx.setWitness(args.funding_spend_vin, witness);

  // The increase in funds also needs a signature added
  if (!!args.add_funds_signature) {
    tx.setWitness(args.add_funds_vin, [
      encodeSig(args.add_funds_signature, signatureFlag),
      hexAsBuffer(args.add_funds_public_key),
    ]);
  }

  return {transaction: tx.toHex()};
};
