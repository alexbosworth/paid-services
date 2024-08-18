const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {decodeConnectedRecords} = require('./../messages');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeConfirmConnected} = require('./../../service_types');

const defaultIntervalMs = 500;
const defaultPollTimes = 2 * 60 * 30;
const defaultRequestTimeoutMs = 1000 * 60;
const missingGroupPartners = 'NoGroupPartnersFound';
const typeGroupChannelId = '1';

/** Confirm local connection and that all partners are connected

  {
    coordinator: <Group Coordinator Identity Public Key Hex String>
    count: <Group Members Count Number>
    id: <Group Identifier Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({coordinator, count, id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!coordinator) {
          return cbk([400, 'ExpectedCoordinatorToConfirmGroupConnection']);
        }

        if (!count) {
          return cbk([400, 'ExpectedMembersCountToConfirmGroupConnected']);
        }

        if (!id) {
          return cbk([400, 'ExpectedGroupIdToConfirmGroupConnection']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToConfirmGroupConnected']);
        }

        return cbk();
      },

      // Connect to the coordinator to send the connected message
      connect: ['validate', ({}, cbk) => {
        return connectPeer({lnd, id: coordinator}, cbk);
      }],

      // Send connection confirmation request
      request: ['connect', ({}, cbk) => {
        return asyncRetry({
          errorFilter: err => {
            const [code, message] = err;

            // Retry when there was a local error
            if (!code) {
              return true;
            }

            // Continue retrying when there are others still connecting
            if (message === missingGroupPartners) {
              return true;
            }

            return false;
          },
          interval: defaultIntervalMs,
          times: defaultPollTimes,
        },
        cbk => {
          return makePeerRequest({
            lnd,
            records: [{type: typeGroupChannelId, value: id}],
            timeout: defaultRequestTimeoutMs,
            to: coordinator,
            type: serviceTypeConfirmConnected,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            if (!res.records || !res.records.length) {
              return cbk([503, missingGroupPartners]);
            }

            // Make sure that connected records are valid
            try {
              decodeConnectedRecords({records: res.records});
            } catch (err) {
              return cbk([503, err.message]);
            }

            const connected = decodeConnectedRecords({records: res.records});

            // Exit with error when connections are missing
            if (connected.count !== count) {
              return cbk([503, missingGroupPartners]);
            }

            return cbk();
          });
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
