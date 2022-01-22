const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncRetry = require('async/retry');
const {getIdentity} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {updateChannelFee} = require('ln-sync');

const acceptCapacityChange = require('./accept_capacity_change');
const askToSelectChange = require('./ask_to_select_change');
const getCapacityChangeRequests = require('./get_capacity_change_requests');
const initiateCapacityChange = require('./initiate_capacity_change');

const interval = 1000 * 10;
const {isArray} = Array;
const times = 6 * 60 * 6;

/** Change a channel's capacity

  {
    ask: <Ask Function>
    [delay]: <Wait Time For Incoming Capacity Requests Milliseconds Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [nodes]: [{
      lnd: <Authenticated LND API Object>
      named: <Node Named String.
      public_key: <Node Identity Public Key Hex String>
    }]
  }
*/
module.exports = ({ask, delay, lnd, logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToChangeCapacity']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToChangeCapacity']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerObjectToChangeCapacity']);
        }

        if (!!nodes && !isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfControlledNodesToChangeCapacity']);
        }

        return cbk();
      },

      // Ask to confirm what will happen in a change capacity
      askToConfirm: ['validate', ({}, cbk) => {
        const details = [
          'This is experimental. Channels may force-close instead of change.',
          'Adding funds currently requires an extra confirmation wait.',
          'Chain fees will be deducted from the changed capacity total.',
          'Chain fees will be paid from the initiator local balance.',
          'Forwards with the peer will be halted during capacity change.',
        ];

        // Show the warnings
        logger.info({details});

        return ask({type: 'confirm', name: 'ok', message: 'OK?'}, ({ok}) => {
          if (!ok) {
            return cbk([400, 'CanceledChannelCapacityChange']);
          }

          return cbk();
        });
      }],

      // Get the public key of this node
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Wait for an incoming capacity change request
      waitForProposal: ['validate', ({}, cbk) => {
        return getCapacityChangeRequests({delay, lnd}, cbk);
      }],

      // Ask for acceptance of a channel
      askToSelectChange: [
        'askToConfirm',
        'waitForProposal',
        ({waitForProposal}, cbk) =>
      {
        return asyncDetectSeries(waitForProposal.requests, (request, cbk) => {
          return askToSelectChange({
            ask,
            lnd,
            address: request.address,
            capacity: request.capacity,
            channel: request.channel,
            decrease: request.decrease,
            from_id: request.from,
            increase: request.increase,
            to_id: request.to,
            type: request.type,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, res.is_selected);
          });
        },
        cbk);
      }],

      // Accept a capacity change proposal
      acceptChange: ['askToSelectChange', ({askToSelectChange}, cbk) => {
        // Exit early when there is no change proposal to accept
        if (!askToSelectChange) {
          return cbk();
        }

        return acceptCapacityChange({
          lnd,
          logger,
          channel: askToSelectChange.channel,
          from: askToSelectChange.from,
          id: askToSelectChange.id,
          increase: askToSelectChange.increase,
          to: askToSelectChange.to || askToSelectChange.from,
        },
        cbk);
      }],

      // Initiate a capacity change
      initiateChange: [
        'askToSelectChange',
        'getIdentity',
        ({askToSelectChange, getIdentity}, cbk) =>
      {
        if (!!askToSelectChange) {
          return cbk();
        }

        return initiateCapacityChange({
          ask,
          lnd,
          logger,
          nodes: (nodes || []).filter(node => {
            return node.public_key !== getIdentity.public_key;
          }),
        },
        cbk);
      }],

      // Reset the channel routing policies
      adjustPolicy: [
        'acceptChange',
        'getIdentity',
        'initiateChange',
        ({acceptChange, getIdentity, initiateChange}, cbk) =>
      {
        const policy = acceptChange || initiateChange;

        logger.info({restoring_routing_policy: true});

        return asyncRetry({interval, times}, cbk => {
          return updateChannelFee({
            base_fee_mtokens: policy.base_fee_mtokens,
            cltv_delta: policy.cltv_delta,
            fee_rate: policy.fee_rate,
            from: policy.open_from || getIdentity.public_key,
            lnd: policy.open_lnd || lnd,
            transaction_id: policy.transaction_id,
            transaction_vout: policy.transaction_vout,
          },
          cbk);
        },
        cbk);
      }],

      // Capacity change complete
      complete: ['adjustPolicy', ({}, cbk) => {
        logger.info({channel_capacity_successfully_changed: true});

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
