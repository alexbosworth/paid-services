const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const asyncRetry = require('async/retry');
const {getIdentity} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const {updateChannelFee} = require('ln-sync');

const acceptCapacityChange = require('./accept_capacity_change');
const getCapacityChangeRequests = require('./get_capacity_change_requests');
const initiateCapacityChange = require('./initiate_capacity_change');

const interval = 10 * 1000;
const peerName = ({alias, id}) => `${alias} ${id.substring(0, 8)}`.trim();
const times = 6 * 60 * 6;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const waitForCloseInterval = 1000 * 3;

/** Change a channel's capacity

  {
    ask: <Ask Function>
    [delay]: <Wait Time For Incoming Capacity Requests Milliseconds Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }
*/
module.exports = ({ask, delay, lnd, logger}, cbk) => {
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
          return getNodeAlias({lnd, id: request.from}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const change = !!request.increase ? 'Increase' : 'Decrease';
            const delta = request.decrease || request.increase;
            const id = request.channel;
            const peer = peerName(res);
            const publicPrivate = !!request.public_private ? request.public_private : undefined;
            const size = tokensAsBigUnit(request.capacity);

            const action = `${change} capacity ${size} channel ${id}`;
            const by = !!delta ? ` by ${tokensAsBigUnit(delta)}` : '';

            return ask({
              type: 'confirm',
              name: 'accept',
              message: !!publicPrivate ? `${action} with ${peer}${by} and change channel type to ${publicPrivate}?` : `${action} with ${peer}${by}?`,
            },
            ({accept}) => {
              if (!accept) {
                return cbk(null, false);
              }

              // Fail changing when cooperative_close_address is set
              if (!!request.address && !!request.increase) {
                return cbk([400, 'ChannelHasLockedCoopCloseAddressSet']);
              }

              return cbk(null, true);
            });
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
        },
        cbk);
      }],

      // Initiate a capacity change
      initiateChange: ['askToSelectChange', ({askToSelectChange}, cbk) => {
        if (!!askToSelectChange) {
          return cbk();
        }

        return initiateCapacityChange({ask, lnd, logger}, cbk);
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
            lnd,
            base_fee_mtokens: policy.base_fee_mtokens,
            cltv_delta: policy.cltv_delta,
            fee_rate: policy.fee_rate,
            from: getIdentity.public_key,
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
