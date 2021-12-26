const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {fromHex} = Transaction;

/** Generate a dummy PSBT to allow for setting up the channel funding

  {
    [increase_transaction]: <Increase Funds Transaction Hex String>
    open_transaction: <Original Channel Funding Transaction Hex String>
    signature: <Hex Encoded Signature String>
    unsigned_transaction: <Unsigned Capacity Change Replacement Tx Hex String>
    witness_script: <Hex Encoded Funding Witness Script String>
  }

  @returns
  {
    psbt: <Dummy PSBT For Funding Pending Channel Hex String>
  }
*/
module.exports = args => {
  const fundingScript = Buffer.from(args.witness_script, 'hex');
  const replacement = fromHex(args.unsigned_transaction);
  const spending = [args.increase_transaction, args.open_transaction];

  const signature = Buffer.concat([
    hexAsBuffer(args.signature),
    Buffer.from([Transaction.SIGHASH_ALL]),
  ]);

  const closeSpendWitnessStack = [signature, signature, fundingScript];

  replacement.ins.forEach((n, i) => {
    return replacement.setWitness(i, closeSpendWitnessStack);
  });

  // An additional signature is required when adding funds
  if (!!args.increase_transaction) {
    const addFundsSignature = Buffer.concat([
      hexAsBuffer(args.increase_signature),
      Buffer.from([Transaction.SIGHASH_ALL]),
    ]);

    replacement.setWitness(args.increase_transaction_vin, [
      addFundsSignature,
      hexAsBuffer(args.increase_public_key),
    ]);
  }

  const {psbt} = transactionAsPsbt({
    spending: spending.filter(n => !!n),
    transaction: replacement.toHex(),
  });

  return {psbt};
};
