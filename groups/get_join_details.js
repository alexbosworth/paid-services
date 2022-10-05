const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {getChainBalance} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {getGroupDetails} = require('./p2p');

const coordinatorFromJoinCode = n => n.slice(0, 66);
const groupIdFromJoinCode = n => n.slice(66);
const interval = 500;
const isCode = n => !!n && n.length === 98;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const niceName = n => `${n.alias} ${n.id}`.trim();
const times = 2 * 60;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Ask to confirm joining a group

  {
    code: <Group Invite Code String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    capacity: <Channel Capacity Tokens Number>
    coordinator: <Group Coordinator Identity Public Key Hex String>
    count: <Group Members Count>
    id: <Group Id Hex String>
  }
*/
module.exports = ({code, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isCode(code)) {
          return cbk([400, 'ExpectedInviteCodeToGetJoinDetails']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetJoinDetails']);
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

        return cbk(null, {id, coordinator})
      }],

      // Connect to the coordinator
      connect: ['group', ({group}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return connectPeer({lnd, id: group.coordinator}, cbk);
        },
        cbk);
      }],

      // Get the coordinator node alias
      getAlias: ['group', ({group}, cbk) => {
        return getNodeAlias({lnd, id: group.coordinator}, cbk);
      }],

      // Get the group details from the coordinator
      getDetails: ['group', ({group}, cbk) => {
        return getGroupDetails({
          lnd,
          coordinator: group.coordinator,
          id: group.id,
        },
        cbk);
      }],

      // Log the details
      log: [
        'getAlias',
        'getBalance',
        'getDetails',
        ({getAlias, getBalance, getDetails}, cbk) =>
      {
        // Check to make sure that there are on chain funds for this group
        if (getBalance.chain_balance < getDetails.funding) {
          return cbk([
            400,
            'InsufficientChainFundsAvailableToJoinGroup',
            {channel_capacity: tokensAsBigUnit(getDetails.capacity)},
          ]);
        }

        const coordinatedBy = `coordinated by ${niceName(getAlias)}`;
        const members = `${getDetails.count} member group`;
        const size = `with ${tokensAsBigUnit(getDetails.capacity)} channels`;
        const rate = `${getDetails.rate}/vbyte chain fee`;

        logger.info({
          coordinatedBy,
          members,
          size,
          rate,
        });

        return cbk();
      }],

      // Go ahead with the group join
      join: ['getDetails', 'group', 'log', ({getDetails, group}, cbk) => {
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
