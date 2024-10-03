const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {decodeFanoutDetails} = require('./../messages');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeGetFanoutDetails} = require('./../../service_types')

const defaultRequestTimeoutMs = 1000 * 60;
const interval = 3000;
const times = 10;
const typeGroupId = '1';

/** Get details about a fanout group, like the output size and fee rate

  {
    coordinator: <Group Coordinator Identity Public Key Hex String>
    id: <Group Identifier Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    capacity: <Output Size Tokens Number>
    count: <Target Members Count Number>
    rate: <Chain Fee Rate Number>
  }
*/
module.exports = ({coordinator, id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!coordinator) {
          return cbk([400, 'ExpectedCoordinatorToGetFanoutGroupDetails']);
        }

        if (!id) {
          return cbk([400, 'ExpectedGroupIdToGetFanoutGroupDetails']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetFanoutGroupDetails']);
        }

        return cbk();
      },

      // Connect to the coordinator to request the fanout group details
      connect: ['validate', ({}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return connectPeer({lnd, id: coordinator}, cbk);
        },
        cbk);
      }],

      // Send the request for fanout group details
      request: ['connect', ({}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return makePeerRequest({
            lnd,
            records: [{type: typeGroupId, value: id}],
            timeout: defaultRequestTimeoutMs,
            to: coordinator,
            type: serviceTypeGetFanoutDetails,
          },
          cbk);
        },
        cbk);
      }],

      // Parse the fanout group details records
      group: ['request', ({request}, cbk) => {
        try {
          return cbk(null, decodeFanoutDetails({records: request.records}));
        } catch (err) {
          return cbk([503, err.message]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'group'}, cbk));
  });
};
