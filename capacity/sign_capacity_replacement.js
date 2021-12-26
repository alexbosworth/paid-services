const asyncAuto = require('async/auto');
const asyncDetectLimit = require('async/detectLimit');
const {getPublicKey} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {script} = require('bitcoinjs-lib');
const {signTransaction} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');

const bufferAsHex = buffer => buffer.toString('hex');
const {decompile} = script;
const family = 0;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isBuffer} = Buffer;
const limit = 250;
const multiKeyLimit = 100000;
const range = max => [...Array(max).keys()];
const {SIGHASH_ALL} = Transaction;

/** Sign a capacity replacement given a witness for a channel close

  {
    capacity: <Original Channel Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    output: <Channel Funding Output Script Hex String>
    script: <Witness Script String>
    transaction: <Unsigned Transaction Hex String>
    vin: <Replacement Transaction Input Index Number>
  }

  @returns via cbk or Promise
  {
    key: <Public Key Hex String>
    signature: <Signature Hex String>
  }
*/
module.exports = ({capacity, lnd, output, script, transaction, vin}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedCapacityToSignCapacityReplacementTx']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToSignCapacityChangeReplacementTx']);
        }

        if (!output) {
          return cbk([400, 'ExpectedOutputScriptToSignCapacityChangeTx']);
        }

        if (!script) {
          return cbk([400, 'ExpectedWitnessScriptToSignReplacementTx']);
        }

        if (!transaction) {
          return cbk([400, 'ExpectedUnsignedTransactionToSignReplacementTx']);
        }

        if (vin === undefined) {
          return cbk([400, 'ExpectedUtxoSpendIndexToSignReplacementTx']);
        }

        return cbk();
      },

      // Find the local key index for the channel
      findKeyIndex: ['validate', ({}, cbk) => {
        const funding = hexAsBuffer(script);

        const keys = decompile(funding).filter(isBuffer).map(bufferAsHex);

        return asyncDetectLimit(range(multiKeyLimit), limit, (index, cbk) => {
          return getPublicKey({family, index, lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, keys.includes(res.public_key));
          });
        },
        cbk);
      }],

      // Get the public key
      getKey: ['findKeyIndex', ({findKeyIndex}, cbk) => {
        if (findKeyIndex === undefined) {
          return cbk([503, 'FailedToFindChannelMultiSigKeyIndex']);
        }

        return getPublicKey({family, lnd, index: findKeyIndex}, cbk);
      }],

      // Sign the channel funds spend
      signSpend: ['findKeyIndex', ({findKeyIndex}, cbk) => {
        const inputs = [{
          vin,
          key_family: family,
          key_index: findKeyIndex,
          output_script: output,
          output_tokens: capacity,
          sighash: SIGHASH_ALL,
          witness_script: script,
        }];

        return signTransaction({inputs, lnd, transaction}, cbk);
      }],

      // Final signature
      signature: ['getKey', 'signSpend', ({getKey, signSpend}, cbk) => {
        const [signature] = signSpend.signatures;

        return cbk(null, {signature, key: getKey.public_key});
      }],
    },
    returnResult({reject, resolve, of: 'signature'}, cbk));
  });
};
