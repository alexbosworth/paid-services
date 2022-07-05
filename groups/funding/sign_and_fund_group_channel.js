const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {decodePsbt} = require('psbt');
const {extendPsbt} = require('psbt');
const {fundPendingChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {partiallySignPsbt} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');
const {unextractTransaction} = require('psbt');

const {concat} = Buffer;
const dummySignature = Buffer.alloc(1);
const {from} = Buffer;
const {fromHex} = Transaction;
const hashAll = Transaction.SIGHASH_ALL;
const hashDefault = Transaction.SIGHASH_DEFAULT;
const hexAsBuf = hex => Buffer.from(hex, 'hex');
const inputAsOutpoint = n => `${n.transaction_id}:${n.transaction_vout}`;
const interval = 10;
const {isArray} = Array;
const notEmpty = arr => arr.filter(n => !!n);
const spendAsOutpoint = n => `${n.hash.reverse().toString('hex')}:${n.index}`;
const times = 500;

/** Sign and fund group channel

  {
    id: <Pending Channel Id Hex String>
    lnd: <Authenticated LND API Object>
    psbt: <Base Funding PSBT Hex String>
    utxos: [{
      bip32_derivations: [{
        fingerprint: <Public Key Fingerprint Hex String>
        [leaf_hashes]: <Taproot Leaf Hash Hex String>
        path: <BIP 32 Child / Hardened Child / Index Derivation Path String>
        public_key: <Public Key Hex String>
      }]
      [non_witness_utxo]: <UTXO Spending Transaction Hex String>
      transaction_id: <Unspent Transaction Id Hex String>
      transaction_vout: <Unspent Transaction Output Index Number>
      witness_utxo: {
        script_pub: <UTXO Output Script Hex String>
        tokens: <UTXO Tokens Value Number>
      }
    }]
  }

  @returns via cbk or Promise
  {
    psbt: <Partially Signed PSBT Hex String>
  }
*/
module.exports = ({id, lnd, psbt, utxos}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedPendingChannelIdToSignAndFundGroupChan']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToSignAndFundGroupChan']);
        }

        if (!psbt) {
          return cbk([400, 'ExpectedUnsignedPsbtToSignAndFundGroupChannel']);
        }

        if (!isArray(utxos)) {
          return cbk([400, 'ExpectedArrayOfUtxosToSignAndFundGroupChannel']);
        }

        return cbk();
      },

      // Extend the PSBT with the derivation paths
      psbtToSign: ['ecp', 'validate', ({ecp}, cbk) => {
        const tx = fromHex(decodePsbt({ecp, psbt}).unsigned_transaction);

        const inputs = decodePsbt({ecp, psbt}).inputs.map((input, vin) => {
          const outpoint = spendAsOutpoint(tx.ins[vin]);

          // Look for relevant signing instructions
          const utxo = utxos.find(n => inputAsOutpoint(n) === outpoint) || {};

          return {
            bip32_derivations: utxo.bip32_derivations,
            non_witness_utxo: input.non_witness_utxo,
            sighash_type: !!input.non_witness_utxo ? hashAll : hashDefault,
            witness_utxo: input.witness_utxo,
          };
        });

        // Extend the base PSBT with relevant signing information
        return cbk(null, {psbt: extendPsbt({ecp, inputs, psbt}).psbt});
      }],

      // Partially sign the PSBT that funds the channel open
      signPsbt: ['psbtToSign', ({psbtToSign}, cbk) => {
        return partiallySignPsbt({lnd, psbt: psbtToSign.psbt}, cbk);
      }],

      // Set the final signature into the PSBT
      finalizePsbt: ['ecp', 'signPsbt', ({ecp, signPsbt}, cbk) => {
        const signatures = decodePsbt({ecp, psbt: signPsbt.psbt});

        // Create a template transaction to use for the finalized PSBT
        const tx = fromHex(signatures.unsigned_transaction);

        const finalized = signatures.inputs.map((input, vin) => {
          // Exit early when there is no local signature present
          if (!input.partial_sig && !input.taproot_key_spend_sig) {
            return tx.setWitness(vin, [dummySignature]);
          }

          // Exit early when the signature is Taproot
          if (!!input.taproot_key_spend_sig) {
            return tx.setWitness(vin, [hexAsBuf(input.taproot_key_spend_sig)]);
          }

          // Set the public key and signature for v0 SegWit
          const [partial] = input.partial_sig;

          return tx.setWitness(vin, [
            concat([hexAsBuf(partial.signature), from([hashAll])]),
            hexAsBuf(partial.public_key),
          ]);
        });

        // Convert the transaction into a finalized PSBT
        const fundingPsbt = unextractTransaction({
          ecp,
          transaction: tx.toHex(),
          spending: notEmpty(signatures.inputs.map(n => n.non_witness_utxo)),
          utxos: notEmpty(signatures.inputs.map((input, vin) => {
            return {
              vin,
              script_pub: input.witness_utxo.script_pub,
              tokens: input.witness_utxo.tokens,
            };
          })),
        });

        return cbk(null, {psbt: fundingPsbt.psbt});
      }],

      // Fund the pending channel with the finalized PSBT
      fundChannel: ['finalizePsbt', ({finalizePsbt}, cbk) => {
        return fundPendingChannels({
          lnd,
          channels: [id],
          funding: finalizePsbt.psbt,
        },
        cbk);
      }],

      // Confirm that the outgoing pending channel is present
      confirmOutPending: ['ecp', 'fundChannel', ({ecp}, cbk) => {
        const tx = fromHex(decodePsbt({ecp, psbt}).unsigned_transaction);

        // Wait for the outgoing pending channel to be present
        return asyncRetry({interval, times}, cbk => {
          return getPendingChannels({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const ids = res.pending_channels.map(n => n.transaction_id);

            if (!ids.includes(tx.getId())) {
              return cbk([503, 'FailedToFindPendingChannelForGroupOpen']);
            }

            return cbk();
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'signPsbt'}, cbk));
  });
};
