const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const asyncTimeout = require('async/timeout');
const {connectPeer} = require('ln-sync');
const {getChainBalance} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const {getGroupDetails} = require('./../groups/p2p');
const {serviceTypeGetFanoutDetails} = require('./../service_types')

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
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    output_count: <Output Count Number>
  }

  @returns via cbk or Promise
  {
    capacity: <Channel Capacity Tokens Number>
    coordinator: <Group Coordinator Identity Public Key Hex String>
    count: <Group Members Count>
    id: <Group Id Hex String>
    rate: <Chain Fee Tokens Per VByte Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isCode(args.code)) {
          return cbk([400, 'ExpectedChannelGroupInviteCodeToGetJoinDetails']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetJoinGroupDetails']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerObjectToGetJoinDetails']);
        }

        if (!args.output_count || !isNumber(args.output_count)) {
            return cbk([400, 'ExpectedOutputCountToJoinGroupFanout']);
        }

        return cbk();
      },

      // Get the wallet balance to make sure there are enough funds to join
      getBalance: ['validate', ({}, cbk) => getChainBalance({lnd: args.lnd}, cbk)],

      // Parse the group join code
      group: ['validate', ({}, cbk) => {
        const coordinator = coordinatorFromJoinCode(args.code);

        if (!isPublicKey(coordinator)) {
          return cbk([400, 'ExpectedValidGroupJoinCodeToRequestGroupDetails']);
        }

        const id = groupIdFromJoinCode(args.code);

        return cbk(null, {id, coordinator})
      }],

      // Connect to the coordinator
      connect: ['group', ({group}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          args.logger.info({connecting_to: group.coordinator});

          return asyncTimeout(connectPeer, defaultTimeoutMs)({
            id: group.coordinator,
            lnd: args.lnd,
          },
          cbk);
        },
        cbk);
      }],

      // Get the coordinator node alias to log it out
      getAlias: ['group', ({group}, cbk) => {
        return getNodeAlias({id: group.coordinator, lnd: args.lnd}, cbk);
      }],

      // Get the group details from the coordinator
      getDetails: ['connect', 'group', ({group}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          args.logger.info({requesting_group_details_from: group.coordinator});

          return getGroupDetails({
            coordinator: group.coordinator,
            id: group.id,
            lnd: args.lnd,
            service_type_get_details: serviceTypeGetFanoutDetails,
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
        const members = `${getDetails.count} member group`;
        const size = `with ${tokensAsBigUnit(getDetails.capacity)} output size`;
        const rate = `and paying ${getDetails.rate}/vbyte chain fee`;

        args.logger.info({joining: join([members, coordinatedBy, size, rate])});

        const requiredFunding = getDetails.funding * args.output_count;

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
