const {address} = require('bitcoinjs-lib');
const {networks} = require('bitcoinjs-lib');
const {Transaction} = require('bitcoinjs-lib');

const isOpenWitnessScript = require('./is_open_witness_script');

const bufferAsHex = buffer => buffer.toString('hex');
const {fromHex} = Transaction;
const hashFromTxId = id => Buffer.from(id, 'hex').reverse();
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const sequence = 0;
const {toOutputScript} = address;
let secondChannelFundingOutput = {};

/** Put together the replacement transaction

  {
    [add_funds_transaction_id]: <Add Funds Transaction Id Hex String>
    [add_funds_transaction_vout]: <Add Funds Transaction Output Index Number>
    bitcoinjs_network: <BitcoinJs Network Name String>
    close_transaction: <Force Closed Transaction Hex String>
    decrease: [{
      output: <Output Script Hex Encoded String>
      tokens: <Decrease By Tokens Number>
    }]
    funding_address: <Replacement Channel Funding Address String>
    funding_tokens: <Replacement Channel Funding Tokens Number>
    transaction_id: <Original Channel Funding Transaction Id Hex String>
    transaction_vout: <Original Channel Funding Output Index Number>
  }

  @throws
  <Error>

  @returns
  {
    [add_funds_vin]: <Add Funds Input Index>
    transaction: <Unsigned Transaction Hex String>
    transaction_id: <Transaction Id Hex String>
    transaction_vin: <Input Index of Original Channel Spend Number>
    transaction_vout: <Replacement Channel Transaction Output Index Number>
  }
*/
module.exports = args => {
  if (!args.bitcoinjs_network) {
    throw new Error('ExpectedBitcoinJsNetworkNameToAssembleReplacementTx');
  }

  if (!args.close_transaction) {
    throw new Error('ExpectedCloseTransactionToAssembleReplacementTx');
  }

  if (!isArray(args.decrease)) {
    throw new Error('ExpectedArrayOfDecreasesToAssembleReplacementTx');
  }

  if (!args.funding_address) {
    throw new Error('ExpectedFundingAddressToAssembleReplacementTx');
  }

  if (!args.funding_tokens) {
    throw new Error('ExpectedFundingTokensToAssembleReplacementTx');
  }

  if (!args.transaction_id) {
    throw new Error('ExpectedFundingTransactionIdToAssembleReplacementTx');
  }

  if (args.transaction_vout === undefined) {
    throw new Error('ExpectedFundingTransactionVoutToAssembleReplacementTx');
  }

  const replacement = new Transaction();

  // The replacement will spend the same input as the close transaction
  const [{witness}, secondInput] = fromHex(args.close_transaction).ins;

  // Confirm that the witness stack is a 2:2
  if (!isOpenWitnessScript({script: bufferAsHex(witness.slice().pop())})) {
    throw new Error('ExpectedMultiSigWitnessInCloseTransaction');
  }

  if (!!secondInput) {
    throw new Error('ExpectedOnlySingleInputForCloseTransaction');
  }

  // The replacement will spend the funding outpoint
  const hash = hashFromTxId(args.transaction_id);
  const index = args.transaction_vout;

  // The new channel multi-sig will be the replacement output
  const network = networks[args.bitcoinjs_network];

  // The replacement spends to the channel funding output
  const fundingOutput = {
    script: toOutputScript(args.funding_address, network),
    tokens: args.funding_tokens,
  };

  //Check if there is a 2nd pubkey to open a channel to
  const [pubkey] = args.decrease.map(n => n.pubkey);

  let outputs;
  if(!!pubkey) {
    const address = args.second_funding_address;
    const [tokens] = args.decrease.map(n => n.tokens);

    const secondChannelFundingOutput = {
      script: toOutputScript(address, network),
      tokens: tokens,
    };
    outputs = [].concat(secondChannelFundingOutput).concat(fundingOutput);
  }
  else {
    // There can also be other outputs attached
      const decreaseOutputs = args.decrease.map(({output, tokens}) => ({
      tokens,
      script: hexAsBuffer(output),
    }));
    outputs = [].concat(decreaseOutputs).concat(fundingOutput);
  }

  // Sort outputs by BIP 69
  outputs.sort((a, b) => {
    // Sort by tokens ascending when no tie breaker needed
    if (a.tokens !== b.tokens) {
      return a.tokens - b.tokens;
    }

    // Otherwise compare output scripts lexicographically ascending
    return a.script.compare(b.script);
  });

  const respendOutputIndex = outputs.findIndex(out => {
    return out.script.equals(fundingOutput.script);
  });

  // Add the outputs to the replacement transaction
  outputs.forEach(({script, tokens}) => replacement.addOutput(script, tokens));

  // Exit early when not adding more inputs to the transaction
  if (!args.add_funds_transaction_id) {
    replacement.addInput(hash, index, sequence);

    return {
      transaction: replacement.toHex(),
      transaction_id: replacement.getId(),
      transaction_vin: replacement.ins.findIndex(input => {
        return input.hash.equals(hash) && input.index === index;
      }),
      transaction_vout: respendOutputIndex,
    };
  }

  // An additional input needs to be added when adding funds
  const add = {
    hash: hashFromTxId(args.add_funds_transaction_id),
    index: args.add_funds_transaction_vout,
  };

  // Adding funds means spending the channel output plus the transit one
  const spends = [{hash, index}, add];

  // Sort the spending inputs for BIP 69
  spends.sort((a, b) => {
    const aHash = bufferAsHex(a.hash);
    const bHash = bufferAsHex(b.hash);

    return aHash.localeCompare(bHash) || a.index - b.index;
  });

  // Add the spends as inputs to the replacement tx
  spends.forEach(({hash, index}) => replacement.addInput(hash, index));

  return {
    add_funds_vin: replacement.ins.findIndex(input => {
      return input.hash.equals(add.hash) && input.index === add.index;
    }),
    transaction: replacement.toHex(),
    transaction_id: replacement.getId(),
    transaction_vin: replacement.ins.findIndex(input => {
      return input.hash.equals(hash) && input.index === index;
    }),
    transaction_vout: respendOutputIndex,
  };
};
