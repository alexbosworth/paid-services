const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const asyncTimeout = require('async/timeout');
const {connectPeer} = require('ln-sync');
const {getChainBalance} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const getFanoutDetails = require('./get_fanout_details');

const coordinatorFromJoinCode = n => n.slice(0, 66);
const defaultTimeoutMs = 1000 * 60;
const groupIdFromJoinCode = n => n.slice(66);
const interval = 500;
const isCode = n => !!n && n.length === 98;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const join = arr => arr.join(' ');
const niceName = n => `${n.alias} ${n.id}`.trim();
const times = 2 * 60;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Ask to confirm joining a group

  {
    code: <Group Invite Code String>
    count: <Output Count Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    capacity: <Fanout Output Capacity Tokens Number>
    coordinator: <Group Coordinator Identity Public Key Hex String>
    count: <Group Members Count>
    id: <Group Id Hex String>
    rate: <Chain Fee Tokens Per VByte Number>
  }
*/
module.exports = ({code, count, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isCode(code)) {
          return cbk([400, 'ExpectedFanoutGroupInviteCodeToGetJoinDetails']);
        }

        if (!count || !isNumber(count)) {
          return cbk([400, 'ExpectedOutputCountToJoinGroupFanout']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetJoinGroupDetails']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerObjectToGetJoinDetails']);
        }

        return cbk();
      },

      // Get the wallet balance to make sure there are enough funds to join
      getBalance: ['validate', ({}, cbk) => getChainBalance({lnd}, cbk)],

      // Parse the group join code
      group: ['validate', ({}, cbk) => {
        const coordinator = coordinatorFromJoinCode(code);

        if (!isPublicKey(coordinator)) {
          return cbk([400, 'ExpectedValidGroupJoinCodeToRequestGroupDetails']);
        }

        const id = groupIdFromJoinCode(code);

        return cbk(null, {coordinator, id});
      }],

      // Connect to the coordinator
      connect: ['group', ({group}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          logger.info({connecting_to: group.coordinator});

          return asyncTimeout(connectPeer, defaultTimeoutMs)({
            lnd,
            id: group.coordinator,
          },
          cbk);
        },
        cbk);
      }],

      // Get the coordinator node alias to log it out
      getAlias: ['group', ({group}, cbk) => {
        return getNodeAlias({lnd, id: group.coordinator}, cbk);
      }],

      // Get the group details from the coordinator once connected
      getDetails: ['connect', 'group', ({group}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          logger.info({requesting_group_details_from: group.coordinator});

          return getFanoutDetails({
            lnd,
            coordinator: group.coordinator,
            id: group.id,
          },
          cbk);
        },
        cbk);
      }],

      // Log the details of the group being joined
      log: [
        'getAlias',
        'getBalance',
        'getDetails',
        ({getAlias, getBalance, getDetails}, cbk) =>
      {
        const coordinatedBy = `coordinated by ${niceName(getAlias)}`;
        const members = `${getDetails.count} member fanout group`;
        const size = `with ${tokensAsBigUnit(getDetails.capacity)} outputs`;
        const rate = `and paying ${getDetails.rate}/vbyte chain fee`;

        logger.info({joining: join([members, coordinatedBy, size, rate])});

        const requiredFunding = getDetails.funding * count;

        // Check to make sure that there are on chain funds for this group
        if (getBalance.chain_balance < requiredFunding) {
          return cbk([
            400,
            'InsufficientChainFundsAvailableToJoinGroup',
            {chain_balance: getBalance.chain_balance},
          ]);
        }

        return cbk();
      }],

      // Go ahead with the group join
      join: ['getDetails', 'group', ({getDetails, group}, cbk) => {
        return cbk(null, {
          capacity: getDetails.capacity,
          coordinator: group.coordinator,
          count: getDetails.count,
          id: group.id,
          rate: getDetails.rate,
        });
      }],
    },
    returnResult({reject, resolve, of: 'join'}, cbk));
  });
};
