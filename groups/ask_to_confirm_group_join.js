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
    ask: <Ask Function>
    [code]: <Invite Code String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
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
module.exports = ({ask, code, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToConfirmGroupJoin']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToConfirmGroupJoin']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToConfirmGroupJoin']);
        }

        return cbk();
      },

      // Ask for the group entry code
      askForCode: ['validate', ({}, cbk) => {
        // Exit early if join code is already present
        if (!!code) {
          return cbk(null, code);
        }

        return ask({
          name: 'code',
          message: 'Enter a group join code to join a group',
          validate: input => !!isCode(input),
        },
        ({code}) => cbk(null, code));
      }],

      // Get the wallet balance to make sure there are enough funds to join
      getBalance: ['validate', ({}, cbk) => getChainBalance({lnd}, cbk)],

      // Parse the group join code
      group: ['askForCode', ({askForCode}, cbk) => {
        const coordinator = coordinatorFromJoinCode(askForCode);

        if (!isPublicKey(coordinator)) {
          return cbk([400, 'ExpectedValidGroupJoinCodeToRequestGroupDetails']);
        }

        const id = groupIdFromJoinCode(askForCode);

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

      // Confirm the group join
      ok: [
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

        // Skip confirmation if non-interactive open
        if (!!code) {
          logger.info({
            coordinatedBy,
            members,
            size,
            rate
          });

          return cbk(null, true);
        }

        return ask({
          name: 'join',
          message: `Join ${members} ${size} at ${rate}, ${coordinatedBy}?`,
          type: 'confirm',
        },
        ({join}) => cbk(null, join));
      }],

      // Go ahead with the group join
      join: ['getDetails', 'group', 'ok', ({getDetails, group, ok}, cbk) => {
        if (!ok) {
          return cbk([400, 'CanceledGroupChannelJoin']);
        }

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
