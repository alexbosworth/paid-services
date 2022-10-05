const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getMethods} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const attachToChannelGroup = require('./attach_to_channel_group');
const coordinateChannelGroup = require('./coordinate_channel_group');

const createOption = 'create';
const halfOf = n => Number(n) / 2;
const isCode = n => !!n && n.length === 98;
const isOdd = n => !!(n % 2);
const joinOption = 'join';
const maxGroupSize = 420;
const minChannelSize = 2e4;
const minGroupSize = 2;
const signPsbtEndpoint = '/walletrpc.WalletKit/SignPsbt';

/** Join a channel group

  {
    ask: <Ask Function>
    [capacity]: <Channel Capacity Number>
    [count]: <Group Size Number>
    [invite_code]: <Invite Code String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [rate]: <Opening Fee Rate Number>
    [type]: <Group Open Type String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToJoinGroup']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageGroup']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToManageGroupJoin']);
        }

        if (!!args.type) {
          if (args.type !== createOption && args.type !== joinOption) {
            return cbk([400, 'ExpectedValidTypeToManageGroupJoin']);
          }

          if (args.type === createOption && !args.capacity) {
            return cbk([400, 'ExpectedChannelCapacityToManageGroupJoin']);
          }

          if (args.type === createOption && args.capacity < minChannelSize) {
            return cbk([400, 'ExpectedCapacityGreaterThanMinimumCapacityToManageGroupJoin']);
          }

          if (args.type === createOption && isOdd(args.capacity)) {
            return cbk([400, 'ExpectedEvenChannelCapacityToManageGroupJoin']);
          }

          if (args.type === createOption && !args.rate) {
            return cbk([400, 'ExpectedFeeRateToManageGroupJoin']);
          }

          if (args.type === createOption && !args.count) {
            return cbk([400, 'ExpectedGroupSizeToManageGroupJoin']);
          }

          if (args.type === createOption && (args.count > maxGroupSize || args.count < minGroupSize)) {
            return cbk([400, 'ExpectedValidGroupSizeToManageGroupJoin']);
          }

          if (args.type === joinOption && !isCode(args.invite_code)) {
            return cbk([400, 'ExpectedValidInviteCodeToManageGroupJoin']);
          }
        }

        return cbk();
      },

      // Get methods to confim partial signing is supported
      getMethods: ['validate', ({}, cbk) => getMethods({lnd: args.lnd}, cbk)],

      getBalance: ['validate', ({}, cbk) => {
        // Exit early if group open is interactive 
        if (!args.type) {
          return cbk();
        }

        const isPair = args.count === minGroupSize;

        getChainBalance({lnd: args.lnd}, (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!isPair && args.capacity > res.chain_balance) {
            return cbk([400, 'ExpectedCapacityLowerThanChainBalance']);
          }

          if (isPair && halfOf(args.capacity) > res.chain_balance) {
            return cbk([400, 'ExpectedCapacityLowerThanChainBalance']);
          }

          return cbk();
        });
      }],

      // Select a group open option
      select: ['getBalance', 'validate', ({}, cbk) => {
        if (!!args.type) {
          return cbk(null, args.type);
        }
        
        return args.ask({
          choices: [
            {name: 'Join existing group', value: joinOption},
            {name: 'Coordinate new group', value: createOption},
          ],
          name: 'option',
          type: 'list',
        },
        ({option}) => cbk(null, option));
      }],

      // Make sure that partially signing a PSBT is valid
      confirmSigner: ['getMethods', 'select', ({getMethods, select}, cbk) => {
        if (!getMethods.methods.find(n => n.endpoint === signPsbtEndpoint)) {
          return cbk([400, 'ExpectedLndSupportingPartialPsbtSigning']);
        }

        return cbk();
      }],

      // Create a new group
      create: ['select', ({select}, cbk) => {
        // Exit early when not creating a new group
        if (select !== createOption) {
          return cbk();
        }

        return coordinateChannelGroup({
          ask: args.ask,
          capacity: args.capacity,
          count: args.count, 
          lnd: args.lnd, 
          logger: args.logger,
          rate: args.rate,
        }, 
        cbk);
      }],

      // Join an existing group
      join: ['select', ({select}, cbk) => {
        // Exit early when not joining an existing group
        if (select !== joinOption) {
          return cbk();
        }

        return attachToChannelGroup({
          ask: args.ask,
          code: args.invite_code, 
          lnd: args.lnd, 
          logger: args.logger
        }, 
        cbk);
      }],

      // Opening the group channel
      opening: ['create', 'join', ({create, join}, cbk) => {
        args.logger.info({opening: create || join});

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
