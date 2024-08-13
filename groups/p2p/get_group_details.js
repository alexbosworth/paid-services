const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {decodeGroupDetails} = require('./../messages');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeGetGroupDetails} = require('./../../service_types');

const defaultRequestTimeoutMs = 1000 * 60;
const interval = 3000;
const times = 10;
const typeGroupChannelId = '1';

/** Get details about a channel group

  {
    coordinator: <Group Coordinator Identity Public Key Hex String>
    id: <Group Identifier Hex String>
    lnd: <Authenticated LND API Object>
    [service]: <Get Details Service Type Number>
  }

  @returns via cbk or Promise
  {
    capacity: <Channel Capacity Tokens Number>
    count: <Target Members Count Number>
    funding: <Amount Of Funding Required Tokens Number>
    rate: <Chain Fee Rate Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.coordinator) {
          return cbk([400, 'ExpectedCoordinatorToGetGroupDetails']);
        }

        if (!args.id) {
          return cbk([400, 'ExpectedGroupIdToGetGroupDetails']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetGroupDetails']);
        }

        return cbk();
      },

      // Connect to the coordinator to request the group details
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.coordinator, lnd: args.lnd}, cbk);
      }],

      // Send the request for group details
      request: ['connect', ({}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return makePeerRequest({
            lnd: args.lnd,
            records: [{type: typeGroupChannelId, value: args.id}],
            timeout: defaultRequestTimeoutMs,
            to: args.coordinator,
            type: args.service || serviceTypeGetGroupDetails,
          },
          cbk);
        },
        cbk);
      }],

      // Parse the group details records
      group: ['request', ({request}, cbk) => {
        try {
          return cbk(null, decodeGroupDetails({records: request.records}));
        } catch (err) {
          return cbk([503, err.message]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'group'}, cbk));
  });
};
