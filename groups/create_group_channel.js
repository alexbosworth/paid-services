const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getIdentity} = require('ln-service');
const {getMethods} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');

const assembleChannelGroup = require('./assemble_channel_group');

const join = arr => arr.join(', ');
const maxGroupSize = 420;
const minChannelSize = 2e4;
const minGroupSize = 2;
const niceName = ({alias, id}) => `${alias} ${id}`.trim();
const signPsbtEndpoint = '/walletrpc.WalletKit/SignPsbt';

/** Join a channel group

  {
    ask: <Ask Function>
    capacity: <Channel Capacity Number>
    count: <Size Of Group Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    rate: <Opening Fee Rate Number>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToCreateGroup']);
        }

        if (args.capacity < minChannelSize) {
          return cbk([400, 'ExpectedChannelCapacityGreaterThanMinChannelSizeToCreateGroup'])
        }

        if (!args.count) {
          return cbk([400, 'ExpectedGroupSizeToCreateGroupp']);
        }

        if (args.count < minGroupSize || args.count > maxGroupSize) {
          return cbk([400, 'ExpectedValidGroupSizeToCreateGroup']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateGroup']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToCreateGroupp']);
        }

        if (!args.rate) {
          return cbk([400, 'ExpectedOpeningFeeRateToCreateGroup']);
        }

        return cbk();
      },

      // Get identity public key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Get methods to confim partial signing is supported
      getMethods: ['validate', ({}, cbk) => getMethods({lnd: args.lnd}, cbk)],

      // Make sure that partially signing a PSBT is valid
      confirmSigner: ['getMethods', ({getMethods}, cbk) => {
        if (!getMethods.methods.find(n => n.endpoint === signPsbtEndpoint)) {
          return cbk([400, 'ExpectedLndSupportingPartialPsbtSigning']);
        }

        return cbk();
      }],

      // Fund and assemble the group
      create: [
        'ecp',
        'confirmSigner',
        'getIdentity',
        ({ecp, getIdentity}, cbk) =>
      {
        const coordinate = assembleChannelGroup({
          ecp,
          capacity: args.capacity,
          count: args.count,
          identity: getIdentity.public_key,
          lnd: args.lnd,
          rate: args.rate,
        });

        const code = getIdentity.public_key + coordinate.id;

        args.logger.info({group_invite_code: code});

        // The group must fill up with participants first
        coordinate.events.once('filled', async ({ids}) => {
          const members = ids.filter(n => n !== getIdentity.public_key);

          const nodes = await asyncMap(members, async id => {
            return niceName(await getNodeAlias({id, lnd: args.lnd}));
          });

          return args.logger.info({ready: join(nodes)});
        });

        // Once filled, members will connect with their partners
        coordinate.events.once('connected', () => args.logger.info({peered: true}));

        // Members will propose pending channels to each other
        coordinate.events.once('proposed', () => {
          return args.logger.info({proposed: true});
        });

        // Once all pending channels are in place, signatures will be received
        coordinate.events.once('signed', () => args.logger.info({signed: true}));

        // Finally the open channel tx will be broadcast
        coordinate.events.once('broadcasting', broadcast => {
          return args.logger.info({publishing: broadcast.transaction});
        });

        // Finally the open channel tx is broadcast
        coordinate.events.once('broadcast', broadcast => {
          coordinate.events.removeAllListeners();

          return cbk(null, {transaction_id: broadcast.id});
        });

        coordinate.events.once('error', err => {
          return cbk([503, 'UnexpectedErrorAssemblingChannelGroup', {err}]);
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'create'}, cbk));
  });
};
