const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncMap = require('async/map');
const {connectPeer} = require('ln-sync');
const {fundPsbtDisallowingInputs} = require('ln-sync');
const {createChainAddress} = require('ln-service');
const {getUtxos} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {unlockUtxo} = require('ln-service');

const asOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const {isArray} = Array;
const isEven = n => !(n % 2);
const isNumber = n => !isNaN(n);
const nestedSegWitAddressFormat = 'np2wpkh';
const nestedSegWitPath = "m/49'/";

/** Fund and propose a fanout to a peer

  {
    capacity: <Channel Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    inputs: [<Outpoints String>]
    output_count: <Output Count Number>
    rate: <Fee Rate Number>
    [to]: <Peer Id Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    [change]: <Change Output Script Hex String>
    funding: <Funding Output Script Hex String>
    id: <Pending Channel Id Hex String>
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
      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedCapacityToProposeFanout']);
        }

        if (!args.count) {
          return cbk([400, 'ExpectedGroupCountToProposeFanout']);
        }

        if (!isArray(args.inputs)) {
          return cbk([400, 'ExpectedArrayOfInputsToProposeFanout']);
        }

        if (!isEven(args.capacity)) {
          return cbk([400, 'ExpectedEventCapacityToProposeFanout']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProposeFanout']);
        }

        if (!args.output_count || !isNumber(args.output_count)) {
          return cbk([400, 'ExpectedOutputCountToProposeFanout']);
        }

        if (!args.rate) {
          return cbk([400, 'ExpectedChainFeeRateToProposeFanout']);
        }

        return cbk();
      },

      // Get utxos
      getInputs: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

      getFilteredInputs: ['getInputs', ({getInputs}, cbk) => {
        if (!args.inputs.length) {
          return cbk(null, getInputs);
        }

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

      // Make sure the peer is connected
      connect: ['getFilteredInputs', ({}, cbk) => {
        return connectPeer({id: args.to, lnd: args.lnd}, cbk);
      }],

      // Generate addresses to fund
      propose: ['connect', ({}, cbk) => {
        return asyncMap(Array(args.output_count).fill(), (_, cbk) => {
          return createChainAddress({is_unused: true, lnd: args.lnd}, (err, res) => {
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
      fund: ['getFilteredInputs', 'propose', ({getFilteredInputs, propose}, cbk) => {
        console.log(propose);
        // Nested SegWit can't be used because LND 0.15.0 can't sign with it
        const nestedSegWitInputs = getFilteredInputs.utxos.filter(utxo => {
          return utxo.address_format === nestedSegWitAddressFormat;
        });

        return fundPsbtDisallowingInputs({
          disallow_inputs: nestedSegWitInputs.map(input => ({
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
      funding: ['fund', 'propose', ({fund, propose}, cbk) => {
        const [proposal] = propose.pending;

        // Look for a nested input that was selected to confirm there are none
        const nested = fund.inputs.find(input => {
          return input.bip32_derivations.find(derivation => {
            return derivation.path.startsWith(nestedSegWitPath);
          });
        });

        // Make sure there were no nested inputs that were selected
        if (!!nested) {
          return cbk([503, 'FailedToSelectNativeSegWitnInputsForChannel']);
        }

        // Find the change output
        const change = fund.outputs.find(n => n.is_change);

        // Find the funding output
        const funding = fund.outputs.find(n => !n.is_change);

        // UTXOs have been selected
        return cbk(null, {
          change: !!change ? change.output_script : undefined,
          funding: !!args.to ? funding.output_script : undefined,
          id: proposal.id,
          overflow: !!change ? change.tokens : undefined,
          utxos: fund.inputs.map(input => ({
            bip32_derivations: input.bip32_derivations,
            lock_id: input.lock_id,
            non_witness_utxo: input.non_witness_utxo,
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
            witness_utxo: input.witness_utxo,
          })),
        });
      }],
    },
    returnResult({reject, resolve, of: 'funding'}, cbk));
  });
};