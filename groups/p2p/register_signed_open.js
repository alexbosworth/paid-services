const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {decodeSignedRecords} = require('./../messages');
const {encodeSignedOpen} = require('./../messages');
const {makePeerRequest} = require('./../../p2p');
const {serviceTypeRegisterSignedOpen} = require('./../../service_types');

const defaultIntervalMs = 500;
const defaultPollTimes = 2 * 60 * 30;
const defaultRequestTimeoutMs = 1000 * 60;
const {isArray} = Array;
const missingGroupPartners = 'NoGroupPartnersFound';
const typeGroupChannelId = '1';
const typeSignedFunding = '2';

/** Register signed open with the coordinator

  {
    coordinator: <Group Coordinator Identity Public Key Hex String>
    count: <Group Members Count Number>
    group: <Group Id Hex String>
    lnd: <Authenticated LND API Object>
    signed: <Signed PSBT Hex String>
    [service]: <Signed Service Type Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.coordinator) {
          return cbk([400, 'ExpectedCoordinatorToRegisterSignedOpen']);
        }

        if (!args.count) {
          return cbk([400, 'ExpectedMembersCountToRegisterSignedOpen']);
        }

        if (!args.group) {
          return cbk([400, 'ExpectedGroupIdentifierToRegisterSignedOpen']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToRegisterSignedFundingOpen']);
        }

        if (!args.signed) {
          return cbk([400, 'ExpectedSignedPsbtToRegisterSignedOpen']);
        }

        return cbk();
      },

      // Connect to the coordinator to send the registered pending message
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.coordinator, lnd: args.lnd}, cbk);
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

            // Continue retrying when there are others still signing
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
            lnd: args.lnd,
            records: [
              {type: typeGroupChannelId, value: args.group},
              {type: typeSignedFunding, value: args.signed},
            ],
            timeout: defaultRequestTimeoutMs,
            to: args.coordinator,
            type: args.service || serviceTypeRegisterSignedOpen,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            // Make sure that signed response records are valid
            try {
              decodeSignedRecords({records: res.records});
            } catch (err) {
              return cbk([503, err.message]);
            }

            const signed = decodeSignedRecords({records: res.records});

            // Exit with error when connections are missing
            if (signed.count !== args.count) {
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
