const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncMap = require('async/map');

const {createChainAddress} = require('ln-service');
const {fundPsbt} = require('ln-service');
const {decodePsbt} = require('psbt');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {unlockUtxo} = require('ln-service');
const tinysecp = require('tiny-secp256k1');

const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const {isArray} = Array;
const isEven = n => !(n % 2);
const isNumber = n => !isNaN(n);
const nestedSegWitAddressFormat = 'np2wpkh';
const nestedSegWitPath = "m/49'/";

/** Get fanout funding details

  {
    capacity: <Fanout Output Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    inputs: [<Outpoints String>]
    output_count: <Output Count Number>
    rate: <Fee Rate Number>
  }

  @returns via cbk or Promise
  {
    [change]: <Change Output Script Hex String>
    funding: [<Funding Output Script Hex String>]
    [overflow]: <Funding Overflow Number>
    utxos: [{
      bip32_derivations: [{
        fingerprint: <Public Key Fingerprint Hex String>
        [leaf_hashes]: <Taproot Leaf Hash Hex String>
        path: <BIP 32 Child / Hardened Child / Index Derivation Path String>
        public_key: <Public Key Hex String>
      }]
      lock_id: <UTXO Lock Id Hex String>
      [non_witness_utxo]: <UTXO Spending Transaction Hex String>
      transaction_id: <Unspent Transaction Id Hex String>
      transaction_vout: <Unspent Transaction Output Index Number>
      witness_utxo: {
        script_pub: <UTXO Output Script Hex String>
        tokens: <UTXO Tokens Value Number>
      }
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedCapacityToGetFundingDetails']);
        }

        if (!args.count) {
          return cbk([400, 'ExpectedGroupCountToGetFundingDetails']);
        }

        if (!isArray(args.inputs) || !args.inputs.length) {
          return cbk([400, 'ExpectedArrayOfInputsToGetFundingDetails']);
        }

        if (!isEven(args.capacity)) {
          return cbk([400, 'ExpectedEventCapacityToGetFundingDetails']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetFundingDetails']);
        }

        if (!args.output_count || !isNumber(args.output_count)) {
          return cbk([400, 'ExpectedOutputCountToGetFundingDetails']);
        }

        if (!args.rate) {
          return cbk([400, 'ExpectedChainFeeRateToGetFundingDetails']);
        }

        return cbk();
      },

      // Get utxos
      getInputs: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

      getFilteredInputs: ['getInputs', ({getInputs}, cbk) => {
        const capacity = args.capacity * args.output_count;

        const outpoints = getInputs.utxos.map(n => {
          return asOutpoint(n);
        });

        // Exit early when outpoints are not present in your utxos
        const allInputsPresent = args.inputs.every(input => outpoints.includes(input));

        if (!allInputsPresent) {
          return cbk([400, 'ExpectedValidUtxosToProposeFanout']);
        }

        // Exit early when there is a nested segwit input
        const hasNestedSegwitInput = args.inputs.some(input => {
          const utxo = getInputs.utxos.find(n => asOutpoint(n) === input);
          return utxo && utxo.address_format === nestedSegWitAddressFormat;
        });

        if (!!hasNestedSegwitInput) {
          return cbk([400, 'ExpectedNonNestedSegwitAddressToProposeFanout']);
        }

        // Filter the utxos passed as args from getInputs and return them
        const filteredUtxos = getInputs.utxos.map(n => {
          const outpoint = asOutpoint(n);

          return args.inputs.includes(outpoint) ? n : undefined;
        }).filter(n => !!n);

        // Exit early when there are not enough utxos to fund
        if (filteredUtxos.reduce((sum, n) => sum + n.tokens, 0) <= capacity) {
          return cbk([400, 'ExpectedUtoxsAmountAboveCapacityToProposeFanout']);
        }

        return cbk(null, {utxos: filteredUtxos});
      }],

      // Generate addresses to fund
      propose: ['validate', ({}, cbk) => {
        return asyncMap(Array(args.output_count).fill(), (_, cbk) => {
          return createChainAddress({is_unused: false, lnd: args.lnd}, (err, res) => {
            if (err) {
              return cbk(err);
            }
            
            return cbk(null, {address: res.address, tokens: args.capacity});
          });
        }, (err, res) => {
          if (err) {
            return cbk(err);
          }
          
          return cbk(null, {pending: res});
        });
      }],

      // Fund the address to populate UTXOs that can be used
      fund: [
      'getFilteredInputs',
      'propose',
      ({getFilteredInputs, propose}, cbk) => {
        return fundPsbt({
          inputs: getFilteredInputs.utxos.map(input => ({
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          })),
          fee_tokens_per_vbyte: args.rate,
          lnd: args.lnd,
          outputs: propose.pending.map(output => ({
            address: output.address,
            tokens: output.tokens,
          })),
        },
        cbk);
      }],

      // Unlock UTXOs
      unlock: ['fund', ({fund}, cbk) => {
        return asyncEach(fund.inputs, (input, cbk) => {
          return unlockUtxo({
            id: input.lock_id,
            lnd: args.lnd,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          },
          cbk);
        },
        cbk);
      }],

      // Final funding elements
      funding: ['ecp', 'fund', 'propose', 'unlock', ({ecp, fund, propose}, cbk) => {
        const {inputs} = decodePsbt({ecp, psbt: fund.psbt});

        // Look for a nested input that was selected to confirm there are none
        const nested = inputs.find(input => {
          return input.bip32_derivations.find(derivation => {
            return derivation.path.startsWith(nestedSegWitPath);
          });
        });

        // Make sure there were no nested inputs that were selected
        if (!!nested) {
          return cbk([503, 'FailedToSelectNativeSegWitnInputsForFanout']);
        }

        // Find the change output
        const change = fund.outputs.find(n => n.is_change);

        // Gather the funding output scripts
        const funding = fund.outputs.filter(n => !n.is_change).map(n => n.output_script);

        // UTXOs have been selected
        return cbk(null, {
          change: !!change ? change.output_script : undefined,
          funding: funding,
          overflow: !!change ? change.tokens : undefined,
          utxos: fund.inputs.map((input, vin) => ({
            bip32_derivations: inputs[vin].bip32_derivations,
            lock_id: input.lock_id,
            non_witness_utxo: inputs[vin].non_witness_utxo,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
            witness_utxo: inputs[vin].witness_utxo,
          })),
        });
      }],
    },
    returnResult({reject, resolve, of: 'funding'}, cbk));
  });
};