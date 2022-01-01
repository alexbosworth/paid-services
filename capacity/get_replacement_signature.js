const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {closeChannel} = require('ln-service');
const {decodeChanId} = require('bolt07');
const {getChainTransactions} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const signCapacityReplacement = require('./sign_capacity_replacement');
const witnessScriptFromCloseTxs = require('./witness_script_from_close_txs');

const blocksBuffer = 1;
const {fromHex} = Transaction;
const interval = 200;
const notFoundIndex = -1;
const times = 72000;
const txIdAsHash = id => Buffer.from(id, 'hex').reverse();

/** Close channel and then sign the unsigned replacement transaction

  {
    channel: <Replace Channel Standard Format Id String>
    id: <Channel Funding Transaction Id Hex String>
    lnd: <Authenticated LND API Object>
    output: <Original Funding Output Script Hex String>
    unsigned: <Unsigned Replacement Transaction Hex String>
    vout: <Channel Funding Output Index Number>
  }

  @returns via cbk or Promise
  {
    signature: <Funding Spend Signature Hex String>
    transaction_id: <Replacement Transaction Id Hex String>
    transaction_vout: <Replacement Transaction Output Index Number>
  }
*/
module.exports = ({channel, id, lnd, output, unsigned, vout}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!channel) {
          return cbk([400, 'ExpectedChannelIdToSignReplacementTransaction']);
        }

        if (!id) {
          return cbk([400, 'ExpectedFundingTxIdToSignReplacementTransaction']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToSignReplacementTransaction']);
        }

        if (!output) {
          return cbk([400, 'ExpectedOutputScriptToGetReplacementSignature']);
        }

        if (!unsigned) {
          return cbk([400, 'ExpectedUnsignedTxToGetReplacementSignature']);
        }

        if (vout === undefined) {
          return cbk([400, 'ExpectedFundingOutputIndexToGetReplacementSig']);
        }

        return cbk();
      },

      // Find input index that is respending the original funding outpoint
      vin: ['validate', ({}, cbk) => {
        const inputIndex = fromHex(unsigned).ins.findIndex(input => {
          return input.index === vout && input.hash.equals(txIdAsHash(id));
        });

        if (inputIndex === notFoundIndex) {
          return cbk([503, 'ExpectedReplacementTransactionSpendingFunding']);
        }

        return cbk(null, inputIndex);
      }],

      // Force close the channel to allow for looking up the public key
      closeChannel: ['vin', ({}, cbk) => {
        return closeChannel({
          lnd,
          is_force_close: true,
          transaction_id: id,
          transaction_vout: vout,
        },
        cbk);
      }],

      // Get the pending close channels to see the final channel balance
      getPending: ['closeChannel', ({}, cbk) => {
        return getPendingChannels({lnd}, cbk);
      }],

      // Get the post close channel transactions to find the open/close txs
      getTx: ['closeChannel', ({}, cbk) => {
        const after = decodeChanId({channel}).block_height - blocksBuffer;

        return getChainTransactions({after, lnd}, cbk);
      }],

      // Find the funding witness script in the close transaction
      script: ['closeChannel', 'getTx', ({closeChannel, getTx}, cbk) => {
        try {
          const {script} = witnessScriptFromCloseTxs({
            closing_tx_id: closeChannel.transaction_id,
            transactions: getTx.transactions,
            transaction_id: id,
            transaction_vout: vout,
          });

          return cbk(null, script);
        } catch (err) {
          return cbk([503, err.message]);
        }
      }],

      // Find the pending channel close that was just force closed
      pending: [
        'closeChannel',
        'getPending',
        ({closeChannel, getPending}, cbk) =>
      {
        // The pending close tx has the closing transaction id
        const pending = getPending.pending_channels.find(chan => {
          return chan.transaction_id === id && chan.transaction_vout === vout;
        });

        if (!pending) {
          return cbk([503, 'ExpectedPendingChannelToGetReplacementSignature']);
        }

        // There should be no pending payments on the channel
        if (!!pending.pending_payments && !!pending.pending_payments.length) {
          return cbk([503, 'ExpectedNoActiveHtlcsOnCapacityChangeChannel']);
        }

        // Return the local balance expected to be returned in replacement
        return cbk(null, {
          capacity: pending.capacity,
          local_balance: pending.local_balance,
          partner_public_key: pending.partner_public_key,
        });
      }],

      // Given the unsigned transaction, look for the matching open proposal
      waitForProposal: ['pending', ({pending}, cbk) => {
        const id = fromHex(unsigned).getId();

        return asyncRetry({interval, times}, cbk => {
          return getPendingChannels({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            // Find an incoming channel that indicates it's safe to sign reopen
            const incomingChannel = res.pending_channels.find(channel => {
              // This will be an opening channel
              if (!channel.is_opening) {
                return false;
              }

              // The new channel must be from the same peer
              if (channel.partner_public_key !== pending.partner_public_key) {
                return false;
              }

              // The new channel must be spending the old transaction
              if (channel.transaction_id !== id) {
                return false;
              }

              // The new channel must have at least the balance of the old one
              if (channel.local_balance < pending.local_balance) {
                return false;
              }

              return true;
            });

            if (!incomingChannel) {
              return cbk([503, 'FailedToFindPendingReplacementChannel']);
            }

            return cbk(null, {
              transaction_id: incomingChannel.transaction_id,
              transaction_vout: incomingChannel.transaction_vout,
            });
          });
        },
        cbk);
      }],

      // Sign the channel funding to prepare to authorize the new channel
      signFunding: [
        'pending',
        'script',
        'vin',
        'waitForProposal',
        ({pending, script, vin, waitForProposal}, cbk) =>
      {
        return signCapacityReplacement({
          lnd,
          output,
          script,
          vin,
          capacity: pending.capacity,
          transaction: unsigned,
        },
        cbk);
      }],

      // Final signature
      signature: [
        'signFunding',
        'waitForProposal',
        ({signFunding, waitForProposal}, cbk) =>
      {
        return cbk(null, {
          signature: signFunding.signature,
          transaction_id: waitForProposal.transaction_id,
          transaction_vout: waitForProposal.transaction_vout,
        });
      }],
    },
    returnResult({reject, resolve, of: 'signature'}, cbk));
  });
};
