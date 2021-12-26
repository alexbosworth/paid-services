const asyncAuto = require('async/auto');
const asyncDoUntil = require('async/doUntil');
const asyncReflect = require('async/reflect');
const {broadcastChainTransaction} = require('ln-service');
const {cancelPendingChannel} = require('ln-service');
const {fundPendingChannels} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');

const finalizeCapacityReplacement = require('./finalize_capacity_replacement');
const getCapacityReplacement = require('./get_capacity_replacement');
const interimReplacementPsbt = require('./interim_replacement_psbt');
const {makePeerRequest} = require('./../p2p');
const {serviceTypeSignCapacityChange} = require('./service_types');

const capacityChangeIdType = '0';
const findSignatureRecord = records => records.find(n => n.type === '1');
const fuzzHeight = 3;
const maxSigHexLength = 146;
const peerRequestTimeoutMs = 1000 * 60 * 10;
const rebroadcastDelayMs = 1000 * 3;
const {SIGHASH_ALL} = Transaction;
const transitFamily = 805;
const unsignedTransactionType = '1';

/** Propose the capacity change to be accepted

  {
    bitcoinjs_network: <BitcoinJS Network Name String>
    channel: <Channel to Change Standard Format Channel Id String>
    decrease: [{
      address: <Spend to Chain Address String>
      output: <Spend to Output Script Hex String>
      tokens: <Spend Value Number>
    }]
    id: <Capacity Change Request Id Hex String>
    [increase]: <Increase Channel Size Tokens Number>
    [increase_key_index]: <Increase Funds Transit Key Number>
    [increase_output_script]: <Increase Funds Output Script Hex String>
    [increase_transaction_id]: <Increase Funds Outpoint Tx Id Hex String>
    [increase_transaction_vout]: <Increase Funds Outpoint Output Index Number>
    [increase_witness_script]: <Increase Funds Witness Script Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    open_transaction: <Original Channel Funding Transaction Hex String>
    partner_public_key: <Peer Public Key Hex Encoded String>
    transaction_id: <Original Channel Transaction Id Hex String>
    transaction_vout: <Original Channel Transaction Output Index Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Replacement Channel Transaction Id Hex String>
    transaction_vout: <Replacement Channel Transaction Output Index Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.bitcoinjs_network) {
          return cbk([400, 'ExpectedBitcoinjsNetworkNameToProposeChange']);
        }

        if (!args.channel) {
          return cbk([400, 'ExpectedChannelIdToProposeCapacityChangeFor']);
        }

        if (!args.decrease) {
          return cbk([400, 'ExpectedDecreaseSetToProposeCapacityChange']);
        }

        if (!args.id) {
          return cbk([400, 'ExpectedChangeRequestIdToProposeCapacityChange']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProposeCapacityChange']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToProposeCapacityChange']);
        }

        if (!args.open_transaction) {
          return cbk([400, 'ExpectedChannelOpenTxToProposeCapacityChange']);
        }

        if (!args.partner_public_key) {
          return cbk([400, 'ExpectedPeerNodeIdToProposeCapacityChange']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedOriginalTxIdToProposeCapacityChange']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedOriginalChannelTxOutputIndexToPropose']);
        }

        return cbk();
      },

      // Get the starting height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Close the current channal and get the unsigned replacement
      getReplacement: ['validate', ({}, cbk) => {
        return getCapacityReplacement({
          add_funds_transaction_id: args.increase_transaction_id,
          add_funds_transaction_vout: args.increase_transaction_vout,
          bitcoinjs_network: args.bitcoinjs_network,
          decrease: args.decrease,
          id: args.channel,
          increase: args.increase,
          lnd: args.lnd,
          open_transaction: args.open_transaction,
          transaction_id: args.transaction_id,
          transaction_vout: args.transaction_vout,
        },
        cbk);
      }],

      // Replacement channel outpoint
      replacement: ['getReplacement', ({getReplacement}, cbk) => {
        args.logger.info({pending_chan_id: getReplacement.pending_channel_id});

        return cbk(null, {
          transaction_id: getReplacement.transaction_id,
          transaction_vout: getReplacement.transaction_vout,
        });
      }],

      // Partially sign the replacement transaction using the add funds key
      signAddFunds: ['getReplacement', ({getReplacement}, cbk) => {
        // Exit early when there are no additional funds added
        if (!args.increase) {
          return cbk(null, {});
        }

        return signTransaction({
          inputs: [{
            key_family: transitFamily,
            key_index: args.increase_key_index,
            output_script: args.increase_output_script,
            output_tokens: args.increase,
            sighash: SIGHASH_ALL,
            vin: getReplacement.add_funds_vin,
            witness_script: args.increase_witness_script,
          }],
          lnd: args.lnd,
          transaction: getReplacement.unsigned_transaction,
        },
        cbk);
      }],

      // Use the unsigned replacement transaction to "fund" the pending channel
      fundWithReplacement: [
        'getReplacement',
        'signAddFunds',
        ({getReplacement, signAddFunds}, cbk) =>
      {
        const [addFundsSignature] = signAddFunds.signatures || [];

        const {psbt} = interimReplacementPsbt({
          increase_public_key: args.increase_key,
          increase_signature: addFundsSignature,
          increase_transaction: args.increase_transaction,
          increase_transaction_vin: getReplacement.add_funds_vin,
          open_transaction: args.open_transaction,
          signature: getReplacement.signature,
          unsigned_transaction: getReplacement.unsigned_transaction,
          witness_script: getReplacement.witness_script,
        });

        // Create the commitment transaction with the peer on the replacement
        return fundPendingChannels({
          channels: [getReplacement.pending_channel_id],
          funding: psbt,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Send the final go ahead signal now that a proposal is made
      getPeerSignature: [
        'getReplacement',
        'fundWithReplacement',
        asyncReflect(({getReplacement}, cbk) =>
      {
        return makePeerRequest({
          lnd: args.lnd,
          records: [
            {
              type: unsignedTransactionType,
              value: getReplacement.unsigned_transaction,
            },
            {
              type: capacityChangeIdType,
              value: args.id,
            },
          ],
          timeout: peerRequestTimeoutMs,
          to: args.partner_public_key,
          type: serviceTypeSignCapacityChange,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!res.records) {
            return cbk([503, 'ExpectedSignatureResponseFromPeerForChange']);
          }

          const record = findSignatureRecord(res.records);

          if (!record || record.value.length > maxSigHexLength) {
            return cbk([503, 'ExpectedSignatureRecordFromPeerForChange']);
          }

          return cbk(null, record.value);
        });
      })],

      // Cancel the funding proposal when there is an error
      cancelFunding: [
        'getPeerSignature',
        'getReplacement',
        ({getPeerSignature, getReplacement}, cbk) =>
      {
        // Exit early when there is no need to cancel
        if (!getPeerSignature.error) {
          return cbk();
        }

        return cancelPendingChannel({
          id: getReplacement.pending_channel_id,
          lnd: args.lnd,
        },
        err => {
          if (!!err) {
            return cbk([503, 'FailedToCancelPendingChannel', {err}]);
          }

          // Return the original error
          return cbk(getPeerSignature.error);
        });
      }],

      // Broadcast the new funding transaction using the peer's signature
      confirmFunding: [
        'getHeight',
        'getPeerSignature',
        'getReplacement',
        'signAddFunds',
        ({getHeight, getPeerSignature, getReplacement, signAddFunds}, cbk) =>
      {
        // Exit early when there was an error getting the peer signature
        if (!!getPeerSignature.error) {
          return cbk();
        }

        const [addFundsSignature] = signAddFunds.signatures || [];

        // Insert the peer signature to get the final signed funding tx
        const {transaction} = finalizeCapacityReplacement({
          add_funds_vin: getReplacement.add_funds_vin,
          add_funds_public_key: args.increase_key,
          add_funds_signature: addFundsSignature,
          local_public_key: getReplacement.signing_key,
          local_signature: getReplacement.signature,
          funding_spend_vin: getReplacement.transaction_vin,
          remote_signature: getPeerSignature.value,
          transaction: getReplacement.unsigned_transaction,
          witness_script: getReplacement.witness_script,
        });

        args.logger.info({publishing_new_channel_transaction: transaction});

        return asyncDoUntil(
          cbk => {
            // Try and override the force close tx using the replacement
            return broadcastChainTransaction({
              transaction,
              after: getHeight.current_block_height - fuzzHeight,
              lnd: args.lnd,
            },
            cbk);
          },
          (broadcast, cbk) => {
            args.logger.info({waiting_for_confirmation: broadcast.id});

            // Rebroadcast until the transaction is confirmed
            return getChainTransactions({lnd: args.lnd}, (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              const confirmed = res.transactions.filter(n => !!n.is_confirmed);

              // Find the confirmed tx
              const tx = confirmed.find(tx => tx.id === broadcast.id);

              if (!!tx) {
                return cbk(null, true);
              }

              // Find the replacing tx
              const replacing = confirmed.find(tx => {
                return tx.id === getReplacement.force_close_tx_id;
              });

              // Cancel the pending channel if the force close confirms
              if (!!replacing) {
                return cancelPendingChannel({
                  id: getReplacement.pending_channel_id,
                  lnd: args.lnd,
                },
                () => {
                  return cbk([503, 'FailedToReplaceForceCloseTransaction']);
                });
              }

              return getChannels({
                lnd: args.lnd,
                partner_public_key: args.partner_public_key,
              },
              (err, res) => {
                if (!!err) {
                  return cbk(err);
                }

                const channel = res.channels.find(channel => {
                  return channel.transaction_id === broadcast.id
                });

                // Stop broadcasting when a channel shows up
                if (!!channel) {
                  return cbk(null, true);
                }

                // Rebroadcast after a delay
                return setTimeout(() => cbk(null, false), rebroadcastDelayMs);
              });
            });
          },
          cbk
        );
      }],
    },
    returnResult({reject, resolve, of: 'replacement'}, cbk));
  });
};
