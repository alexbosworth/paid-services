const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncReflect = require('async/reflect');
const {broadcastChainTransaction} = require('ln-service');
const {cancelPendingChannel} = require('ln-service');
const {deletePendingChannel} = require('ln-service');
const {fundPendingChannels} = require('ln-service');
const {getChannels} = require('ln-service');
const {getClosedChannels} = require('ln-service');
const {getHeight} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {signTransaction} = require('ln-service');
const {subscribeToBlocks} = require('ln-service');
const {Transaction} = require('bitcoinjs-lib');
const {transactionAsPsbt} = require('psbt');

const finalizeCapacityReplacement = require('./finalize_capacity_replacement');
const getCapacityReplacement = require('./get_capacity_replacement');
const interimReplacementPsbt = require('./interim_replacement_psbt');
const {makePeerRequest} = require('./../p2p');
const {serviceTypeSignCapacityChange} = require('./../service_types');

const capacityChangeIdType = '0';
const findSignatureRecord = records => records.find(n => n.type === '1');
const {fromHex} = Transaction;
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
      [address]: <Decrease Address String>
      [node]: <Create Channel with Node With Public Key Hex String>
      [output]: <Output Script Hex String>
      tokens: <Decrease Tokens Number>
    }]
    id: <Capacity Change Request Id Hex String>
    is_private: <Channel is Private Bool>
    [increase]: <Increase Channel Size Tokens Number>
    [increase_key_index]: <Increase Funds Transit Key Number>
    [increase_output_script]: <Increase Funds Output Script Hex String>
    [increase_transaction_id]: <Increase Funds Outpoint Tx Id Hex String>
    [increase_transaction_vout]: <Increase Funds Outpoint Output Index Number>
    [increase_witness_script]: <Increase Funds Witness Script Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    open_lnd: <Open Replacement Channel Using LND API Object>
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

        if (!args.open_lnd) {
          return cbk([400, 'ExpectedOpenLndApiToProposeCapacityChange']);
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

      // Close the current channel and get the unsigned replacement
      getReplacement: ['validate', ({}, cbk) => {
        return getCapacityReplacement({
          add_funds_transaction_id: args.increase_transaction_id,
          add_funds_transaction_vout: args.increase_transaction_vout,
          bitcoinjs_network: args.bitcoinjs_network,
          decrease: args.decrease,
          id: args.channel,
          is_private: args.is_private,
          increase: args.increase,
          is_private: args.is_private,
          lnd: args.lnd,
          open_lnd: args.open_lnd,
          open_transaction: args.open_transaction,
          transaction_id: args.transaction_id,
          transaction_vout: args.transaction_vout,
        },
        cbk);
      }],

      // The replacement channel outpoint will be returned as a result
      replacement: ['getReplacement', ({getReplacement}, cbk) => {
        args.logger.info({proposal_id: getReplacement.pending_channel_id});

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

      // Derive the funding PSBT to use for funding
      funding: [
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

        return cbk(null, psbt);
      }],

      // Use the unsigned replacement transaction to "fund" the pending channel
      fundWithReplacement: [
        'funding',
        'getReplacement',
        ({funding, getReplacement}, cbk) =>
      {
        const replacement = getReplacement.unsigned_transaction;

        args.logger.info({funding_with_replacement_tx: replacement});

        return fundPendingChannels({
          funding,
          channels: [getReplacement.pending_channel_id],
          lnd: args.open_lnd,
        },
        cbk);
      }],

      // Send the final go ahead signal now that a proposal is made
      getPeerSignature: [
        'fundWithReplacement',
        'getReplacement',
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

          args.logger.info({peer_cosigned_capacity_change: true});

          return cbk(null, record.value);
        });
      })],

      // Fund the additional other channel opens if present
      fundAdditionalOpens: [
        'funding',
        'getPeerSignature',
        'getReplacement',
        asyncReflect(({funding, getPeerSignature, getReplacement}, cbk) =>
      {
        // Exit early when there was an error getting the peer signature
        if (!!getPeerSignature.error) {
          return cbk();
        }

        // Exit early when there is nothing else to fund
        if (!getReplacement.open_pending_ids.length) {
          return cbk();
        }

        // Funding for the additional opens is separated for smoother canceling
        return fundPendingChannels({
          funding,
          channels: getReplacement.open_pending_ids,
          lnd: args.lnd,
        },
        cbk);
      })],

      // Cancel the unfunded channel opens when there is an error
      cancelFunding: [
        'getPeerSignature',
        'getReplacement',
        ({getPeerSignature, getReplacement}, cbk) =>
      {
        // Exit early when there was an error getting the peer signature
        if (!getPeerSignature.error) {
          return cbk();
        }

        const ids = getReplacement.open_pending_ids;

        return asyncEach(ids, asyncReflect((id, cbk) => {
          return cancelPendingChannel({id, lnd: args.lnd}, cbk);
        }),
        cbk);
      }],

      // Broadcast the new funding transaction using the peer's signature
      confirmFunding: [
        'fundAdditionalOpens',
        'getPeerSignature',
        'getReplacement',
        'signAddFunds',
        ({
          fundAdditionalOpens,
          getPeerSignature,
          getReplacement,
          signAddFunds,
        },
        cbk) =>
      {
        // When there is no peer signature, the force close must confirm
        if (!!getPeerSignature.error) {
          return cbk(null, {is_success: false});
        }

        // Do not broadcast a replacement when additional opens fail
        if (!!fundAdditionalOpens.error) {
          return cbk(null, {is_success: false});
        }

        const [addFundsSignature] = signAddFunds.signatures || [];
        const openOutputs = fromHex(args.open_transaction).outs;
        const txId = fromHex(getReplacement.unsigned_transaction).getId();

        const outScript = openOutputs[args.transaction_vout].script;

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

        // Listen to new blocks to wait for the channel change confirmation
        const sub = subscribeToBlocks({lnd: args.lnd});

        // Fail with error when the blocks subscription is lost
        sub.on('error', err => {
          sub.removeAllListeners();

          return cbk([503, 'LostBlockchainSubscription', {err}]);
        });

        // Publish the new channel transaction when a block is received
        sub.on('block', async () => {
          // Broadcast the channel replacement tx
          try {
            await broadcastChainTransaction({transaction, lnd: args.lnd});

            args.logger.info({published_new_channel_tx: txId});
          } catch (err) {
            args.logger.error({err});
          }

          // Look for the new channel to see if the change succeeded
          try {
            const {channels} = await getChannels({lnd: args.open_lnd});

            const channel = channels.find(n => n.transaction_id === txId);

            // Replacement is present but not yet active
            if (!!channel && !channel.is_active) {
              args.logger.info({waiting_for_channel_to_activate: true});
            }

            // The new channel confirmed successfully and so the change worked
            if (!!channel && !!channel.is_active) {
              sub.removeAllListeners();

              return cbk(null, {is_success: true});
            }
          } catch (err) {
            args.logger.error({err});
          }

          // Also look for a force closed channel to see if the change failed
          try {
            const {channels} = await getClosedChannels({lnd: args.lnd});
            const chainTip = await getHeight({lnd: args.lnd});

            const currentHeight = chainTip.current_block_height;

            const channel = channels.find(channel => {
              // The closed channel must have a closed tx id
              if (!channel.close_transaction_id) {
                return false;
              }

              // Only consider channels that are conclusively closed
              if (currentHeight - channel.close_confirm_height < fuzzHeight) {
                return false;
              }

              // Find close channel matching the channel outpoint
              if (channel.transaction_id !== args.transaction_id) {
                return false;
              }

              return channel.transaction_vout === args.transaction_vout;
            });

            // The old channel force closed and so the change fully failed
            if (!!channel && channel.close_transaction_id !== txId) {
              sub.removeAllListeners();

              return cbk(null, {is_success: false});
            }
          } catch (err) {
            args.logger.error({err});
          }

          return;
        });

        return;
      }],

      // Get pending channels to clean up if there was a failure
      getPending: ['confirmFunding', ({confirmFunding}, cbk) => {
        // Exit early when there was no failure
        if (!!confirmFunding.is_success) {
          return cbk();
        }

        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Clean up pending channels that will never confirm
      cleanPendingChannels: [
        'confirmFunding',
        'getPending',
        'getReplacement',
        ({confirmFunding, getPending, getReplacement}, cbk) =>
      {
        // Exit early when the channel activated
        if (!!confirmFunding.is_success) {
          args.logger.info({channel_capacity_changed: true});

          return cbk();
        }

        const replaceId = fromHex(getReplacement.unsigned_transaction).getId();

        // Collect all the pending channels that depend on the replacement
        const pending = getPending.pending_channels
          .filter(n => !!n.is_opening)
          .filter(n => n.transaction_id === replaceId);

        // Delete the pending channels that can never confirm
        return asyncEach(pending, (channel, cbk) => {
          return deletePendingChannel({
            confirmed_transaction: getReplacement.force_close_tx,
            lnd: args.lnd,
            pending_transaction: getReplacement.unsigned_transaction,
            pending_transaction_vout: channel.transaction_vout,
          },
          err => {
            if (!!err) {
              args.logger.error({err});
            }

            return cbk();
          });
        },
        () => {
          return cbk([503, 'FailedToChangeChannelCapacity']);
        });
      }],
    },
    returnResult({reject, resolve, of: 'replacement'}, cbk));
  });
};
