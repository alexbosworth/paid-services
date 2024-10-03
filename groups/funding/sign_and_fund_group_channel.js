const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {decodePsbt} = require('psbt');
const {fundPendingChannels} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signAndFundPsbt} = require('ln-sync');
const tinysecp = require('tiny-secp256k1');
const {Transaction} = require('bitcoinjs-lib');

const {fromHex} = Transaction;
const interval = 10;
const {isArray} = Array;
const times = 500;

/** Sign and fund group channel

  {
    [id]: <Pending Channel Id Hex String>
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
    conflict: <Conflict Transaction Hex String>
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

      // Sign and fund the PSBT
      sign: ['validate', ({}, cbk) => {
        return signAndFundPsbt({lnd, psbt, utxos}, cbk);
      }],

      // Fund the pending channel with the finalized PSBT
      fundChannel: ['sign', ({sign}, cbk) => {
        // Exit early when this is a pair channel and there is no proposal
        if (!id) {
          return cbk();
        }

        return fundPendingChannels({
          lnd,
          channels: [id],
          funding: sign.funding,
        },
        cbk);
      }],

      // Confirm that the outgoing pending channel is present
      confirmOutPending: ['ecp', 'fundChannel', ({ecp}, cbk) => {
        // Exit early when this is a pair channel and there is no proposal
        if (!id) {
          return cbk();
        }

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

      // Final group funding transaction resolution
      result: ['sign', ({sign}, cbk) => {
        return cbk(null, {conflict: sign.conflict, psbt: sign.psbt});
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
