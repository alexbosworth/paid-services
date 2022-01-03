const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToPeerMessages} = require('ln-service');

const capacityChangeRequests = require('./capacity_change_requests');
const {serviceTypeChangeCapacity} = require('./../service_types');
const parseCapacityChangeRequest = require('./parse_capacity_change_request');
const {servicePeerRequests} = require('./../p2p');

const defaultDelayMs = 1000 * 10;
const waitForRequestsTimeoutMs = 5000;

/** Get capacity change requests

  {
    [delay]: <Milliseconds To Wait For Change Requests Number>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    requests: [{
      [address]: <Cooperative Close Address String>
      capacity: <Channel Capacity Tokens Number>
      channel: <Standard Format Channel Id String>
      [decrease]: <Reduce Capacity Tokens Number>
      from: <From Node Public Key Id Hex String>
      id: <Change Request Id Hex String>
      [increase]: <Add Capacity Tokens Number>
      [type]: <Intended Replacement Channel Channel Type Flags Number>
    }]
  }
*/
module.exports = ({delay, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetCapacityChangeRequests']);
        }

        return cbk();
      },

      // Wait for incoming capacity change requests
      getRequests: ['validate', ({}, cbk) => {
        const requests = [];
        const service = servicePeerRequests({lnd});

        // Listen for capacity change requests
        service.request({type: serviceTypeChangeCapacity}, (req, res) => {
          const {from, records} = req;

          const {request} = parseCapacityChangeRequest({from, records});

          // Exit early when the change request message was not understood
          if (!request) {
            return res.failure([400, 'FailedToParseChangeRequest']);
          }

          // Only add new requests
          if (!requests.find(n => n.id === request.id)) {
            requests.push(request);
          }

          return res.success({});
        });

        return setTimeout(() => {
          // Stop listening for requests after a little while
          service.stop({});

          return cbk(null, requests);
        },
        delay || waitForRequestsTimeoutMs);
      }],

      // Get the set of channels
      getChannels: ['getRequests', ({}, cbk) => getChannels({lnd}, cbk)],

      // Final set of capacity change requests
      requests: [
        'getChannels',
        'getRequests',
        ({getChannels, getRequests}, cbk) =>
      {
        const {requests} = capacityChangeRequests({
          channels: getChannels.channels,
          requests: getRequests,
        });

        return cbk(null, {requests});
      }],
    },
    returnResult({reject, resolve, of: 'requests'}, cbk));
  });
};
