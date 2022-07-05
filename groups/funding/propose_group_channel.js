const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {fundPsbtDisallowingInputs} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {openChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {unlockUtxo} = require('ln-service');

const fuzzSize = 1;
const halfOf = n => n / 2;
const isEven = n => !(n % 2);
const nestedSegWitAddressFormat = 'np2wpkh';
const nestedSegWitPath = "m/49'/";

/** Fund and propose a group channel to a peer

  {
    capacity: <Channel Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
    rate: <Fee Rate Number>
    to: <Peer Id Public Key Hex String>
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
module.exports = ({capacity, lnd, rate, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedCapacityToProposeGroupChannel']);
        }

        if (!isEven(capacity)) {
          return cbk([400, 'ExpectedEventCapacityToProposeGroupChannel']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProposeGroupChannel']);
        }

        if (!rate) {
          return cbk([400, 'ExpectedChainFeeRateToProposeGroupChannel']);
        }

        if (!to) {
          return cbk([400, 'ExpectedChannelPartnerPublicKeyToProposeChannel']);
        }

        return cbk();
      },

      // Get inputs to figure out which cannot be used for a group funding
      getInputs: ['validate', ({}, cbk) => getUtxos({lnd}, cbk)],

      // Propose the channel to get an address to fund
      propose: ['validate', ({}, cbk) => {
        return openChannels({
          lnd,
          channels: [{
            capacity,
            give_tokens: halfOf(capacity),
            partner_public_key: to,
          }],
          is_avoiding_broadcast: true,
        },
        cbk);
      }],

      // Fund the address to populate UTXOs that can be used
      fund: ['getInputs', 'propose', ({getInputs, propose}, cbk) => {
        // Nested SegWit can't be used because LND 0.15.0 can't sign with it
        const nestedSegWitInputs = getInputs.utxos.filter(utxo => {
          return utxo.address_format === nestedSegWitAddressFormat;
        });

        return fundPsbtDisallowingInputs({
          lnd,
          disallow_inputs: nestedSegWitInputs.map(input => ({
            transaction_id: input.transaction_id,
            transaction_vout: input.transaction_vout,
          })),
          fee_tokens_per_vbyte: rate,
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
            lnd,
            id: input.lock_id,
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

        // UTXOs have been selected and channel has been proposed to peer
        return cbk(null, {
          change: !!change ? change.output_script : undefined,
          funding: fund.outputs.find(n => !n.is_change).output_script,
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
