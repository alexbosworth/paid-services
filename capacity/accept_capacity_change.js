const asyncAuto = require('async/auto');
const {getChainTransactions} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {stopAllHtlcs} = require('ln-sync');
const {Transaction} = require('bitcoinjs-lib');

const encodeSignCapacityResponse = require('./encode_sign_capacity_response');
const getReplacementSignature = require('./get_replacement_signature');
const {makePeerRequest} = require('./../p2p');
const parseAcceptResponse = require('./parse_accept_response');
const parseSignCapacityRequest = require('./parse_sign_capacity_request');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeAcceptCapacityChange} = require('./../service_types');
const {serviceTypeSignCapacityChange} = require('./../service_types');
const {serviceTypeWaitOnConfirmation} = require('./../service_types');

const acceptChangeTimeoutMs = 1000 * 45;
const bufferAsHex = buffer => buffer.toString('hex');
const findId = records => (records.find(n => n.type === '0') || {}).value;
const {fromHex} = Transaction;
const idType = '0';
const openTxType = '1';

/** Accept a request from a peer to change a channel's capacity

  {
    channel: <Standard Format Channel Id String>
    from: <Accept Request From Public Key Hex String>
    id: <Request Id Hex String>
    [increase]: <Increase Tokens Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    base_fee_mtokens: <Original Forwarding Base Fee Millitokens String>
    cltv_delta: <Original Forwarding CLTV Delta Number>
    fee_rate: <Original Forwarding Parts Per Million Fee Rate Number>
    transaction_id: <Replacement Channel Transaction Id Hex String> 
    transaction_vout: <Replacement Channel Transaction Output Index Number>
  }
*/
module.exports = ({channel, from, id, increase, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!channel) {
          return cbk([400, 'ExpectedChannelIdToAcceptCapacityChange']);
        }

        if (!from) {
          return cbk([400, 'ExpectedFromPublicKeyToAcceptCapacityChange']);
        }

        if (!id) {
          return cbk([400, 'ExpectedRequestIdToAcceptCapacityChange']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAcceptCapacityChange']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerObjectToAcceptCapacityChange']);
        }

        return cbk();
      },

      // Get the fee policies on the channel to set it back on success
      getChannel: ['validate', ({}, cbk) => {
        return getChannel({lnd, id: channel}, cbk);
      }],

      // Get all channel ids with the peer in order to stop HTLCs on them
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd, partner_public_key: from}, cbk);
      }],

      // Get chain transactions to look for the channel open tx
      getChainTxs: ['validate', ({}, cbk) => {
        return getChainTransactions({lnd}, cbk);
      }],

      // Policy for the channel
      policy: ['getChannel', ({getChannel}, cbk) => {
        const policy = getChannel.policies.find(n => n.public_key !== from);

        if (!policy.cltv_delta) {
          return cbk([404, 'FailedToFindChannelRoutingPolicyDetails']);
        }

        return cbk(null, {
          base_fee_mtokens: policy.base_fee_mtokens,
          cltv_delta: policy.cltv_delta,
          fee_rate: policy.fee_rate,
          transaction_id: getChannel.transaction_id,
          transaction_vout: getChannel.transaction_vout,
        });
      }],

      // Send the initial proposal acceptance to the peer
      acceptChange: [
        'getChainTxs',
        'getChannel',
        'getChannels',
        'policy',
        ({getChainTxs, getChannel}, cbk) =>
      {
        const records = [{type: idType, value: id}];

        const tx = getChainTxs.transactions.find(transaction => {
          return transaction.id === getChannel.transaction_id;
        });

        const txRecordValue = !!tx && !!tx.transaction ? tx.transaction : null;

        if (!!txRecordValue) {
          records.push({type: openTxType, value: txRecordValue});
        }

        // Kick off the capacity change
        return makePeerRequest({
          lnd,
          records,
          timeout: acceptChangeTimeoutMs,
          to: from,
          type: serviceTypeAcceptCapacityChange,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          try {
            const {transaction} = parseAcceptResponse({
              records: res.records,
              transaction_id: getChannel.transaction_id,
            });

            if (!transaction && !txRecordValue) {
              return cbk([404, 'MissingTransactionOpenRawTxData']);
            }

            return cbk(null, {transaction: transaction || txRecordValue});
          } catch (err) {
            return cbk([503, err.message]);
          }
        });
      }],

      // Stop HTLCs with the peer until the channel is closed
      stopHtlcs: ['getChannels', ({getChannels}, cbk) => {
        return stopAllHtlcs({
          lnd,
          id: channel,
          ids: getChannels.channels.map(n => n.id),
          peer: from,
        },
        cbk);
      }],

      // Lookup the open transaction and get the output script
      output: [
        'acceptChange',
        'getChannel',
        ({acceptChange, getChannel}, cbk) =>
      {
        const {outs} = fromHex(acceptChange.transaction);

        const output = outs[getChannel.transaction_vout];

        if (!output) {
          return cbk([503, 'ExpectedOpenTxFundingTransactionOutput']);
        }

        return cbk(null, bufferAsHex(output.script));
      }],

      // Ask to change capacity and return the final signature when needed
      changeCapacity: ['output', 'policy', ({output, policy}, cbk) => {
        logger.info({starting_capacity_change: true});

        const service = servicePeerRequests({lnd});

        // Listen for close-and-replace signals
        service.request({type: serviceTypeSignCapacityChange}, (req, res) => {
          // Exit early when the request is from a different peer/change
          if (req.from !== from || findId(req.records) !== id) {
            return;
          }

          const {failure, success} = res;

          const parameters = {
            increase,
            id: policy.transaction_id,
            records: req.records,
            vout: policy.transaction_vout,
          };

          // Check to make sure that the request records make sense
          try {
            parseSignCapacityRequest(parameters);
          } catch (err) {
            logger.error({err: [503, err.message]});

            return failure([503, 'FailedToParseSignChangeRequest']);
          }

          logger.info({closing_and_reopening_channel: true});

          // Trigger the replacement flow and sign the unsigned tx
          return getReplacementSignature({
            channel,
            lnd,
            output,
            id: parameters.id,
            unsigned: parseSignCapacityRequest(parameters).unsigned,
            vout: parameters.vout,
          },
          (err, res) => {
            if (!!err) {
              logger.error({err});

              return failure([503, 'UnexpectedErrorGettingSignature']);
            }

            // Stop listening for sign capacity change requests
            service.stop({});

            // Encode the signature into records
            const {records} = encodeSignCapacityResponse({
              id: parameters.id,
              signature: res.signature,
            });

            // Send the replacement signature for the change request
            success({records});

            logger.info({new_channel_transaction_id: res.transaction_id});

            // Return the replacement funding outpoint
            return cbk(null, {
              transaction_id: res.transaction_id,
              transaction_vout: res.transaction_vout,
            });
          });
        });

        // Listen for wait-for-confirmation signals
        service.request({type: serviceTypeWaitOnConfirmation}, (req, res) => {
          // Exit early when the request is from a different peer/change
          if (req.from !== from || findId(req.records) !== id) {
            return;
          }

          logger.info({peer_is_looking_for_confirmation: new Date()});

          // Return an ack that the waiting signal was heard
          return res.success({});
        });
      }],

      // Accepted the capacity change
      accepted: [
        'changeCapacity',
        'policy',
        ({changeCapacity, policy}, cbk) =>
      {
        return cbk(null, {
          base_fee_mtokens: policy.base_fee_mtokens,
          cltv_delta: policy.cltv_delta,
          fee_rate: policy.fee_rate,
          transaction_id: changeCapacity.transaction_id,
          transaction_vout: changeCapacity.transaction_vout,
        });
      }],
    },
    returnResult({reject, resolve, of: 'accepted'}, cbk));
  });
};
