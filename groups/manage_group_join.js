const asyncAuto = require('async/auto');
const {getMethods} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const attachToChannelGroup = require('./attach_to_channel_group');
const coordinateChannelGroup = require('./coordinate_channel_group');

const createOption = 'create';
const joinOption = 'join';
const signPsbtEndpoint = '/walletrpc.WalletKit/SignPsbt';

/** Join a channel group

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToJoinGroup']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageGroup']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToManageGroupJoin']);
        }

        return cbk();
      },

      // Get methods to confim partial signing is supported
      getMethods: ['validate', ({}, cbk) => getMethods({lnd}, cbk)],

      // Select a group open option
      select: ['validate', ({}, cbk) => {
        return ask({
          choices: [
            {name: 'Join existing group', value: joinOption},
            {name: 'Coordinate new group', value: createOption},
          ],
          name: 'option',
          type: 'select',
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

        return coordinateChannelGroup({ask, lnd, logger}, cbk);
      }],

      // Join an existing group
      join: ['select', ({select}, cbk) => {
        // Exit early when not joining an existing group
        if (select !== joinOption) {
          return cbk();
        }

        return attachToChannelGroup({ask, lnd, logger}, cbk);
      }],

      // Opening the group channel
      opening: ['create', 'join', ({create, join}, cbk) => {
        logger.info({opening: create || join});

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
