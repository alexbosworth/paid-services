const {script} = require('bitcoinjs-lib');

const {decompile} = script;
const expectedScriptElements = 5;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isPublicKey = n => (n[0] === 2 || n[0] === 3) && n.length === 33;
const OP_2 = 82;
const OP_CHECKMULTISIG = 174;

/** Determine if a witness script looks like a channel open

  {
    script: <Hex Encoded Witness Script>
  }

  @returns
  <Looks Like Open Witness Script Bool>
*/
module.exports = ({script}) => {
  const elements = decompile(hexAsBuffer(script));

  if (elements.length !== expectedScriptElements) {
    return false;
  }

  const [requiredSigs, key1, key2, numKeys, checkMultiSig] = elements;

  // A channel funding output is a 2:2
  if (requiredSigs !== OP_2 || numKeys !== OP_2) {
    return false;
  }

  // There are 2 public keys in the script
  if (!isPublicKey(key1) || !isPublicKey(key2)) {
    return false;
  }

  // The OP code checks that the sigs both agree on the spend
  return checkMultiSig === OP_CHECKMULTISIG;
};
