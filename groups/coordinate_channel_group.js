const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getIdentity} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');

const askForGroupDetails = require('./ask_for_group_details');
const assembleChannelGroup = require('./assemble_channel_group');

const join = arr => arr.join(', ');
const niceName = ({alias, id}) => `${alias} ${id}`.trim();

/** Ask for the details of the group to create and then create the group

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    id: <Transaction Id Hex String>
    transaction: <Raw Transaction Hex String>
  }
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateGroup']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateGroup']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToCreateGroup']);
        }

        return cbk();
      },

      // Ask for group details
      askForDetails: ['validate', ({}, cbk) => {
        return askForGroupDetails({ask, lnd}, cbk);
      }],

      // Get identity public key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Fund and assemble the group
      assembleGroup: [
        'ecp',
        'askForDetails',
        'getIdentity',
        ({ecp, askForDetails, getIdentity}, cbk) =>
      {
        const coordinate = assembleChannelGroup({
          ecp,
          lnd,
          capacity: askForDetails.capacity,
          count: askForDetails.count,
          identity: getIdentity.public_key,
          rate: askForDetails.rate,
        });

        const code = getIdentity.public_key + coordinate.id;

        logger.info({group_invite_code: code});

        // The group must fill up with participants first
        coordinate.events.once('filled', async ({ids}) => {
          const members = ids.filter(n => n !== getIdentity.public_key);

          const nodes = await asyncMap(members, async id => {
            return niceName(await getNodeAlias({id, lnd}));
          });

          return logger.info({ready: join(nodes)});
        });

        // Once filled, members will connect with their partners
        coordinate.events.once('connected', () => logger.info({peered: true}));

        // Members will propose pending channels to each other
        coordinate.events.once('proposed', () => {
          return logger.info({proposed: true});
        });

        // Once all pending channels are in place, signatures will be received
        coordinate.events.once('signed', () => logger.info({signed: true}));

        // Finally the open channel tx will be broadcast
        coordinate.events.once('broadcasting', broadcast => {
          return logger.info({publishing: broadcast.transaction});
        });

        // Finally the open channel tx is broadcast
        coordinate.events.once('broadcast', broadcast => {
          coordinate.events.removeAllListeners();

          return cbk(null, {id: broadcast.id});
        });

        coordinate.events.once('error', err => {
          return cbk([503, 'UnexpectedErrorAssemblingChannelGroup', {err}]);
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'assembleGroup'}, cbk));
  });
};
