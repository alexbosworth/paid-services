const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const asyncUntil = require('async/until');
const {acceptsChannelOpen} = require('ln-sync');
const {broadcastChainTransaction} = require('ln-service');
const {broadcastTransaction} = require('ln-sync');
const {closeChannel} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannels} = require('ln-service');
const {getFeeRates} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {payments} = require('bitcoinjs-lib');
const {reserveTransitFunds} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {stopAllHtlcs} = require('ln-sync');
const {Transaction} = require('bitcoinjs-lib');

const askForChangeDetails = require('./ask_for_change_details');
const {makePeerRequest} = require('./../p2p');
const parseAcceptRequest = require('./parse_accept_request');
const proposeCapacityChange = require('./propose_capacity_change');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeAcceptCapacityChange} = require('./service_types');
const {serviceTypeChangeCapacity} = require('./service_types');
const {serviceTypeSignCapacityChange} = require('./service_types');
const {serviceTypeWaitOnConfirmation} = require('./service_types');

const bufferAsHex = buffer => buffer.toString('hex');
const capacityChangeRequestIdType = '0';
const customMessageType = 50800;
const family = 0;
const familyTemporary = 805;
const {fromHex} = Transaction;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const idRecordType = '0';
const makeId = () => randomBytes(32).toString('hex');
const messageFrequencyMs = 3000;
const minimumAddTokens = 20000;
const multiKeyLimit = 100000;
const openTxType = '1';
const {p2wpkh} = payments;
const range = max => [...Array(max).keys()];
const rebroadcastTimeMs = 1000 * 5;
const recordsAsObject = a => a.reduce((sum, n) => sum[n.type] = n.value, {});
const requestCapacityChangeIntervalMs = 2000;
const requestCapacityChangeTimeoutMs = 1000 * 60 * 60 * 6;
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());
const testMessage = '00';
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const uniq = arr => Array.from(new Set(arr));
const waitingPingDelayMs = 1000 * 5;
const waitingTimeoutMs = 1000 * 30;

/** Initiate a channel capacity change

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    base_fee_mtokens: <Forwarding Base Fee Millitokens String>
    cltv_delta: <Forwarding CLTV Delta Number>
    fee_rate: <Forwarding Parts Per Million Fee Rate Number>
    transaction_id: <Replacement Channel Transaction Id Hex String> 
    transaction_vout: <Replacement Channel Transaction Output Index Number>
  }
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Generate a unique identifier for the change
      id: cbk => cbk(null, makeId()),

      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToInitiateCapacityChange']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToInitiateCapacityChange']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerObjectToInitiateCapacityChange']);
        }

        return cbk();
      },

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Ask for all the capacity change details
      askForChangeDetails: ['id', 'validate', ({id}, cbk) => {
        return askForChangeDetails({ask, id, lnd}, cbk);
      }],

      // Propose the theoretical new channel to the peer to confirm a change
      checkAccept: ['askForChangeDetails', ({askForChangeDetails}, cbk) => {
        // Check that a channel open would be accepted
        return acceptsChannelOpen({
          lnd,
          capacity: askForChangeDetails.estimated_capacity,
          cooperative_close_address: askForChangeDetails.coop_close_address,
          give_tokens: askForChangeDetails.remote_balance,
          is_private: askForChangeDetails.is_private,
          min_htlc_mtokens: askForChangeDetails.min_htlc_mtokens,
          partner_csv_delay: askForChangeDetails.partner_csv_delay,
          partner_public_key: askForChangeDetails.partner_public_key,
        },
        cbk);
      }],

      // Get the additional capacity funding
      getFunding: [
        'askForChangeDetails',
        'checkAccept',
        ({askForChangeDetails}, cbk) =>
      {
        // Exit early when additional funding is not necessary
        if (!askForChangeDetails.increase) {
          return cbk(null, {});
        }

        const tokens = askForChangeDetails.increase;

        // Get a signed tx ready that pays the increase in funds
        return reserveTransitFunds({ask, lnd, logger, tokens}, cbk);
      }],

      // Wait for the basic capacity change proposal to be acknowledged
      sendBasicRequest: [
        'askForChangeDetails',
        'getFunding',
        'id',
        ({askForChangeDetails, getFunding, id}, cbk) =>
      {
        const records = [];
        const response = {};
        const service = servicePeerRequests({lnd});
        const start = new Date();
        const type = serviceTypeAcceptCapacityChange;

        if (!!getFunding.refund) {
          logger.info({add_funds_signed_refund_tx: getFunding.refund});
        }

        if (!!askForChangeDetails.open_transaction) {
          records.push({
            type: openTxType,
            value: askForChangeDetails.open_transaction,
          });
        }

        // Listen for the acceptance of the capacity change
        service.request({type}, (req, res) => {
          // Exit early when the request is not from the peer
          if (req.from !== askForChangeDetails.partner_public_key) {
            return;
          }

          const findIdRecord = records => records.find(n => n.type === '0');

          const idRecord = findIdRecord(req.records);

          // Exit early when the request is not for this change request
          if (!idRecord || idRecord.value !== id) {
            return;
          }

          logger.info({peer_accepted_request: true});

          // Stop waiting for a response now that the request has been ack'ed
          service.stop({});

          res.success({records});

          const {transaction} = parseAcceptRequest({
            records: req.records,
            open_transaction: askForChangeDetails.open_transaction,
            transaction_id: askForChangeDetails.transaction_id,
          });

          if (!transaction) {
            const error = [400, 'FundingTxRequiredToChangeCapacity'];

            response.error = error;

            return res.failure(error);
          }

          response.transaction = transaction;

          return;
        });

        logger.info({waiting_for_peer_acceptance: true});

        // This is a repeating request, the peer might not be online
        return asyncUntil(
          cbk => {
            if (!!response.error || !!response.transaction) {
              return cbk(null, true);
            }

            if (new Date() - start > requestCapacityChangeTimeoutMs) {
              return cbk([408, 'TimedOutWaitingForChangeAcceptance']);
            }

            // Stop new pings when there is an ack of the change request
            return cbk(null, false);
          },
          cbk => {
            return makePeerRequest({
              lnd,
              records: askForChangeDetails.records,
              timeout: requestCapacityChangeIntervalMs,
              to: askForChangeDetails.partner_public_key,
              type: serviceTypeChangeCapacity,
            },
            () => {
              // Continue pinging with the proposal
              return setTimeout(cbk, requestCapacityChangeIntervalMs);
            });
          },
          err => {
            service.stop({});

            if (!!response.error) {
              return cbk(response.error);
            }

            if (!!err) {
              return cbk(err);
            }

            return cbk(null, response.transaction);
          }
        );
      }],

      // Get the current channels to double check there is enough local balance
      getPeerChannels: [
        'askForChangeDetails',
        'sendBasicRequest',
        ({askForChangeDetails}, cbk) =>
      {
        return getChannels({
          lnd,
          partner_public_key: askForChangeDetails.partner_public_key,
        },
        cbk);
      }],

      // Stop all HTLCs with the peer until the channel is closed
      stopHtlcs: [
        'askForChangeDetails',
        'getPeerChannels',
        ({askForChangeDetails, getPeerChannels}, cbk) =>
      {
        return stopAllHtlcs({
          lnd,
          id: askForChangeDetails.id,
          ids: getPeerChannels.channels.map(n => n.id),
          peer: askForChangeDetails.partner_public_key,
        },
        cbk);
      }],

      // Broadcast and confirm the add funds transaction into a block
      confirmAddFunds: [
        'askForChangeDetails',
        'getFunding',
        'getPeerChannels',
        'id',
        'sendBasicRequest',
        asyncReflect(({
          askForChangeDetails,
          getFunding,
          getPeerChannels,
          id,
          sendBasicRequest,
        },
        cbk) =>
      {
        const channel = getPeerChannels.channels.find(({id}) => {
          return id === askForChangeDetails.id;
        });

        if (!channel) {
          return cbk([400, 'FailedToFindCapacityChangeChannel']);
        }

        const localBalance = channel.local_balance;

        if (!!channel.pending_payments.length) {
          return cbk([400, 'ExpectedNoPendingPaymentsToChangeCapacity']);
        }

        // Make sure that we still have enough balance in local balance
        if (localBalance + askForChangeDetails.estimated_local_delta < 0) {
          return cbk([400, 'InsufficientRemainingFundsToChangeCapacity']);
        }

        let isHeartbeatAcked = false;
        let isReady = false;

        // This will take some time so start pinging the peer that we are here
        asyncUntil(
          cbk => cbk(null, isReady),
          cbk => {
            return makePeerRequest({
              lnd,
              records: [{type: capacityChangeRequestIdType, value: id}],
              timeout: waitingTimeoutMs,
              to: askForChangeDetails.partner_public_key,
              type: serviceTypeWaitOnConfirmation,
            },
            err => {
              // The peer needs to respond to waiting heartbeats
              if (!!err) {
                return cbk(err);
              }

              isHeartbeatAcked = true;

              return setTimeout(cbk, waitingPingDelayMs);
            });
          },
          cbk
        );

        // Exit early when there is no funding transaction to broadcast
        if (!getFunding.transaction) {
          isReady = true;

          return;
        }

        const channelId = askForChangeDetails.id;

        // Get the funding confirmed
        return asyncUntil(
          cbk => {
            return getChainTransactions({lnd}, (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              const tx = res.transactions
                .filter(tx => tx.is_confirmed)
                .find(tx => tx.transaction === getFunding.transaction);

              // Exit early when there is no confirmed transaction
              if (!tx) {
                logger.info({waiting_for_funds_confirmation: getFunding.id});

                return cbk(null, false);
              }

              // Transaction is confirmed in a block
              logger.info({funds_confirmed: true});

              return cbk(null, true);
            });
          },
          cbk => {
            return broadcastChainTransaction({
              lnd,
              description: `Funds for increasing capacity on ${channelId}`,
              transaction: getFunding.transaction,
            },
            err => {
              if (!!err) {
                logger.error({err});
              }

              return setTimeout(cbk, rebroadcastTimeMs);
            });
          },
          () => {
            // Stop the "we are here" pinging
            return isReady = true;
          }
        );
      })],

      // Propose the capacity change to the peer
      proposeChange: [
        'askForChangeDetails',
        'confirmAddFunds',
        'getFunding',
        'getNetwork',
        'getPeerChannels',
        'id',
        'sendBasicRequest',
        asyncReflect(({
          askForChangeDetails,
          getFunding,
          getNetwork,
          getPeerChannels,
          id,
          sendBasicRequest,
        },
        cbk) =>
      {
        const channel = getPeerChannels.channels.find(channel => {
          return channel.id === askForChangeDetails.id
        });

        logger.info({
          change_channel: {
            id: askForChangeDetails.id,
            transaction_id: channel.transaction_id,
            transaction_vout: channel.transaction_vout,
          },
        });

        return proposeCapacityChange({
          id,
          lnd,
          logger,
          bitcoinjs_network: getNetwork.bitcoinjs,
          channel: askForChangeDetails.id,
          decrease: askForChangeDetails.decrease,
          increase: askForChangeDetails.increase,
          increase_key: getFunding.key,
          increase_key_index: getFunding.index,
          increase_output_script: getFunding.output,
          increase_transaction: getFunding.transaction,
          increase_transaction_id: getFunding.id,
          increase_transaction_vout: getFunding.vout,
          increase_witness_script: getFunding.script,
          open_transaction: sendBasicRequest,
          partner_public_key: askForChangeDetails.partner_public_key,
          transaction_id: channel.transaction_id,
          transaction_vout: channel.transaction_vout,
        },
        cbk);
      })],

      // The replacement channel details
      replacementChannel: [
        'askForChangeDetails',
        'proposeChange',
        ({askForChangeDetails, proposeChange}, cbk) =>
      {
        // Exit early with no replacement when the proposal fails
        if (!!proposeChange.error) {
          return cbk();
        }

        logger.info({published_replacement_channel: proposeChange.value});

        return cbk(null, {
          base_fee_mtokens: askForChangeDetails.base_fee_mtokens,
          cltv_delta: askForChangeDetails.cltv_delta,
          fee_rate: askForChangeDetails.fee_rate,
          transaction_id: proposeChange.value.transaction_id,
          transaction_vout: proposeChange.value.transaction_vout,
        });
      }],

      // Broadcast the add capacity refund transaction if there was an error
      executeRefund: [
        'confirmAddFunds',
        'getFunding',
        'proposeChange',
        ({confirmAddFunds, getFunding, proposeChange}, cbk) =>
      {
        // Exit early when there were no funds added
        if (!confirmAddFunds) {
          return cbk();
        }

        // Exit early when there is no need to refund
        if (!confirmAddFunds.error && !proposeChange.error) {
          return cbk();
        }

        const capacityChangeErr = confirmAddFunds.error || proposeChange.error;

        return broadcastChainTransaction({
          lnd,
          transaction: getFunding.refund,
          description: `Refund for failed capacity change`,
        },
        err => {
          if (!!err) {
            logger.error({err});
          }

          return cbk(capacityChangeErr);
        });
      }],
    },
    returnResult({reject, resolve, of: 'replacementChannel'}, cbk));
  });
};
