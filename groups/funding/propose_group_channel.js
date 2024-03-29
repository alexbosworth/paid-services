const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {connectPeer} = require('ln-sync');
const {fundPsbtDisallowingInputs} = require('ln-sync');
const {getNetwork} = require('ln-sync');
const {getUtxos} = require('ln-service');
const {openChannels} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {payments} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const {unlockUtxo} = require('ln-service');

const dummyKeys = () => ([Buffer.alloc(33, 2), Buffer.alloc(33, 3)]);
const fuzzSize = 1;
const halfOf = n => n / 2;
const isEven = n => !(n % 2);
const minGroupCount = 2;
const nestedSegWitAddressFormat = 'np2wpkh';
const nestedSegWitPath = "m/49'/";

/** Fund and propose a group channel to a peer

  {
    capacity: <Channel Capacity Tokens Number>
    lnd: <Authenticated LND API Object>
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
module.exports = ({capacity, count, lnd, rate, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedCapacityToProposeGroupChannel']);
        }

        if (!count) {
          return cbk([400, 'ExpectedGroupCountToProposeGroupChannel']);
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

        return cbk();
      },

      // Get inputs to figure out which cannot be used for a group funding
      getInputs: ['validate', ({}, cbk) => getUtxos({lnd}, cbk)],

      // Get the bitcoinjs network name for dummy output derivation
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Make sure the peer is connected
      connect: ['getNetwork', ({}, cbk) => {
        // Exit early when this is a pair group
        if (!to) {
          return cbk();
        }

        return connectPeer({lnd, id: to}, cbk);
      }],

      // Propose the channel to get an address to fund
      propose: ['connect', 'getNetwork', ({getNetwork}, cbk) => {
        const tokens = halfOf(capacity);

        // Exit early when there is a shared proposal due to a pair group
        if (!to) {
          const {address} = payments.p2wsh({
            network: networks[getNetwork.bitcoinjs],
            redeem: payments.p2ms({
              m: dummyKeys().length,
              network: networks[getNetwork.bitcoinjs],
              pubkeys: dummyKeys(),
            }),
          });

          // Pretend we are opening a channel when there is no outbound target
          return cbk(null, {pending: [{address, tokens}]});
        }

        // Propose a channel
        return openChannels({
          lnd,
          channels: [{
            capacity,
            give_tokens: tokens,
            partner_public_key: to,
          }],
          is_avoiding_broadcast: true,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit early with the regular pending when it's a normal group size
          if (count > minGroupCount) {
            return cbk(null, res);
          }

          // In a pair group size, remap the funding so that it's only half
          const [{address, id}] = res.pending;

          return cbk(null, {pending: [{address, id, tokens}]});
        });
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

        // Find the funding output
        const funding = fund.outputs.find(n => !n.is_change);

        // UTXOs have been selected
        return cbk(null, {
          change: !!change ? change.output_script : undefined,
          funding: !!to ? funding.output_script : undefined,
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
