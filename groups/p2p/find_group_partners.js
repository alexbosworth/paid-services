const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {decodePartnersRecords} = require('./../messages');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeFindGroupPartners} = require('./../../service_types');

const defaultConnectIntervalMs = 500;
const defaultConnectPollTimes = 2 * 60 * 30;
const defaultGroupPartnersIntervalMs = 500;
const defaultGroupPartnersPollTimes = 2 * 60 * 60 * 24 * 3;
const defaultRequestTimeoutMs = 1000 * 60 * 5;
const minGroupCount = 2;
const missingGroupPartners = 'NoGroupPartnersFound';
const typeGroupChannelId = '1';

/** Find a group partners in a group

  {
    coordinator: <Group Coordinator Identity Public Key Hex String>
    id: <Group Identifier Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    inbound: <Inbound Peer Public Key Identity Hex String>
    outbound: <Outbound Peer Public Key Identity Hex String>
  }
*/
module.exports = ({coordinator, count, id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!coordinator) {
          return cbk([400, 'ExpectedCoordinatorToFindGroupPartners']);
        }

        if (!count) {
          return cbk([400, 'ExpectedGroupMemberCountToFindGroupPartners']);
        }

        if (!id) {
          return cbk([400, 'ExpectedGroupIdToFindGroupPartners']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToFindGroupPartners']);
        }

        return cbk();
      },

      // Connect to the coordinator
      connect: ['validate', ({}, cbk) => {
        return connectPeer({lnd, id: coordinator}, cbk);
      }],

      // Request group partners
      request: ['connect', ({}, cbk) => {
        return asyncRetry({
          errorFilter: err => {
            const [code, message] = err;

            // Retry when there was a local error
            if (!code) {
              return true;
            }

            // Continue retrying when there are no group partners yet
            if (message === missingGroupPartners) {
              return true;
            }

            return false;
          },
          interval: defaultGroupPartnersIntervalMs,
          times: defaultGroupPartnersPollTimes,
        },
        cbk => {
          return makePeerRequest({
            lnd,
            records: [{type: typeGroupChannelId, value: id}],
            timeout: defaultRequestTimeoutMs,
            to: coordinator,
            type: serviceTypeFindGroupPartners,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            // Exit early when the group is a pair
            if (count === minGroupCount) {
              return cbk();
            }

            // Exit with error when there are no group partners
            if (!res.records || !res.records.length) {
              return cbk([503, missingGroupPartners]);
            }

            return cbk(null, res.records);
          });
        },
        cbk);
      }],

      // Parse the group partners response
      partners: ['request', ({request}, cbk) => {
        // Exit early when there are no records
        if (!request) {
          return cbk(null, {outbound: coordinator});
        }

        try {
          return cbk(null, decodePartnersRecords({records: request}));
        } catch (err) {
          return cbk([503, err.message]);
        }
      }],

      // Attempt to connect to the partners
      peer: ['partners', ({partners}, cbk) => {
        // Exit early when there are no partners
        if (!partners.inbound) {
          return cbk();
        }

        return asyncEach([partners.inbound, partners.outbound], (id, cbk) => {
          return asyncRetry({
            interval: defaultConnectIntervalMs,
            times: defaultConnectPollTimes,
          },
          cbk => connectPeer({lnd, id}, cbk),
          cbk);
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'partners'}, cbk));
  });
};
