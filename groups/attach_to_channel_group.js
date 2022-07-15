const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const askToConfirmGroupJoin = require('./ask_to_confirm_group_join');
const joinChannelGroup = require('./join_channel_group');

const formatNodes = arr => arr.join(', ');
const niceName = ({alias, id}) => `${alias} ${id}`.trim();

/** Ask for a channel group to join and then join the group

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    id: <Transaction Id Hex String>
  }
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToEnterChannelGroup']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToEnterChannelGroup']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToAttachToChannelGroup']);
        }

        return cbk();
      },

      // Ask for group details to parse and confirm
      askForDetails: ['validate', ({}, cbk) => {
        return askToConfirmGroupJoin({ask, lnd}, cbk);
      }],

      // Join the channel group
      join: ['askForDetails', ({askForDetails}, cbk) => {
        logger.info({waiting_for_other_members: true});

        const join = joinChannelGroup({
          lnd,
          capacity: askForDetails.capacity,
          coordinator: askForDetails.coordinator,
          count: askForDetails.count,
          id: askForDetails.id,
          rate: askForDetails.rate,
        });

        join.once('end', ({id}) => cbk(null, {transaction_id: id}));
        join.once('error', err => cbk(err));

        join.once('peering', async ({inbound, outbound}) => {
          const nodes = await asyncMap([inbound, outbound], async id => {
            return niceName(await getNodeAlias({id, lnd}));
          });

          return logger.info({peering_with: formatNodes(nodes)});
        });

        join.once('publishing', ({refund, signed}) => {
          return logger.info({refund, signed});
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'join'}, cbk));
  });
};
