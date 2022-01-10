const {Transaction} = require('bitcoinjs-lib');

const {ceil} = Math;
const decreaseBuffer = 44;
const dummyHash = Buffer.alloc(32);
const dummyIncreaseIndex = 1;
const dummyIndex = 0;
const dummyMultiSigScript = Buffer.alloc(71);
const dummyNullDummy = Buffer.alloc(1);
const dummyP2wsh = Buffer.alloc(68);
const dummyPublicKey = Buffer.alloc(33);
const dummySignature = Buffer.alloc(74);
const dummyTokens = 0;
const dummyVout = 0;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const increaseBuffer = 300;
const {max} = Math;
const weightAsVBytes = weight => weight / 4;

/** Calculate the chain fee required for the capacity replacement tx

  {
    capacity: <Original Channel Capacity Tokens Number>
    commit_transaction_fee: <Commit Transaction Fee Tokens Number>
    commit_transaction_weight: <Commit Transaction Weight Units Number>
    decrease: [{
      output: <Output Script Hex String>
      tokens: <Spend Value to Chain Address Tokens Number>
    }]
    [increase]: <Add Funds Tokens Number>
    tokens_per_vbyte: <Minimal Fee Rate Tokens Per VByte Number>
  }

  @returns
  {
    fee: <Estimated Replacement Chain Fee Tokens Number>
  }
*/
module.exports = args => {
  // The cost to close is also known as the commit fee
  const closeTransactionFee = args.commit_transaction_fee;

  // The commitment transaction size will have to be paid for
  const replaceSize = weightAsVBytes(args.commit_transaction_weight);

  // Calculate the rate that the commitment tx is paying
  const commitRate = closeTransactionFee / replaceSize;

  // Create a dummy transaction which models the replacement
  const tx = new Transaction();

  // Add the decreases as outputs
  args.decrease.forEach(({output, tokens}) => {
    if(!!output) {
      return tx.addOutput(hexAsBuffer(output), tokens);
    }
    else {
      return tx.addOutput(dummyP2wsh, tokens);
    }
  });

  // Add an output to represent the new channel output
  tx.addOutput(dummyP2wsh, args.capacity);

  args.decrease.forEach(({output}) => {
    if(!!output) {
      return tx.addOutput(hexAsBuffer(output), dummyTokens);
    }
    else {
      return;
    }
  });

  // Add an input to represent the old channel input
  tx.addInput(dummyHash, dummyVout);

  // Spending a channel close requires both signatures
  const dummyWitnessStack = [
    dummyNullDummy,
    dummySignature,
    dummySignature,
    dummyMultiSigScript,
  ];

  // Add a witness to the input
  tx.setWitness(dummyIndex, dummyWitnessStack);

  // An increase means that there is an additional input
  if (!!args.increase) {
    tx.addInput(dummyHash, dummyVout);

    // Add funds input spends from transit, which means signature + public key
    tx.setWitness(dummyIncreaseIndex, [dummySignature, dummyPublicKey]);
  }

  // Add additional size for an additional input
  const inputBuffer = !!args.increase ? increaseBuffer : dummyTokens;

  // Add additional size for additional outputs
  const outputBuffer = args.decrease.length * decreaseBuffer;

  // Now that we have all inputs and outputs we can measure the virtual bytes
  const size = tx.virtualSize() + inputBuffer + outputBuffer;

  // The fee for the replacement tx must be above a minimum
  const minFee = ceil(size * commitRate);

  // The base fee for replacement is the fee of the replacement
  const baseFee = args.commit_transaction_fee;

  // There is an additional fee which is a relay fee to pay for the replaced tx
  const deltaFee = ceil(replaceSize * args.tokens_per_vbyte);

  // The new tx pays either min replacement fee or the min overall relay fee
  const fee = max(minFee, closeTransactionFee + deltaFee);

  return {fee};
};
