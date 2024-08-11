const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {broadcastTransaction} = require('ln-sync');
const {getChainBalance} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getMethods} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');

const assembleFanoutGroup = require('./assemble_fanout_group');

const descriptionForGroup = 'group fanout';
const halfOf = n => n / 2;
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const isOdd = n => !!(n % 2);
const isValidMembersCount = (n, count) => !n.length || n.length === count - 1;
const join = arr => arr.join(', ');
const maxGroupSize = 420;
const minOutputSize = 2e4;
const minGroupSize = 3;
const niceName = ({alias, id}) => `${alias} ${id}`.trim();
const {now} = Date;
const signPsbtEndpoint = '/walletrpc.WalletKit/SignPsbt';
const staleMs = 1000 * 60 * 5;

/** Create a collaborative fanout

  {
    capacity: <Output Capacity Tokens Number>
    count: <Group Member Count Number>
    [inputs]: [<Utxo Outpoint String>]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [members]: [<Member Identity Public Key Hex String>]
    output_count: <Output Count Number>
    rate: <Opening Chain Fee Tokens Per VByte Rate Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Transaction Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToCreateGroupFanout']);
        }

        if (args.capacity < minOutputSize) {
          return cbk([400, 'ExpectedCapacityGreaterThanMinSizeToCreateGroupFanout']);
        }

        if (isOdd(args.capacity)) {
          return cbk([400, 'ExpectedEvenChannelCapacityToCreateGroupFanout']);
        }

        if (!args.count) {
          return cbk([400, 'ExpectedGroupSizeToCreateGroupFanout']);
        }

        if (args.count < minGroupSize || args.count > maxGroupSize) {
          return cbk([400, 'ExpectedValidGroupSizeToCreateGroupFanout']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateGroupFanout']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToCreateGroupFanout']);
        }

        if (!isArray(args.members)) {
          return cbk([400, 'ExpectedArrayOfGroupMembersToCreateGroupFanout']);
        }

        if (!isValidMembersCount(args.members, args.count)) {
          return cbk([400, 'ExpectedCompleteSetOfAllowedGroupMembers']);
        }

        if (!!args.members.filter(n => !isPublicKey(n)).length) {
          return cbk([400, 'ExpectedNodeIdentityPublicKeysForChannelGroup']);
        }

        if (!args.output_count || !isNumber(args.output_count)) {
          return cbk([400, 'ExpectedOutputCountToCreateGroupFanout']);
        }

        if (!args.rate) {
          return cbk([400, 'ExpectedOpeningFeeRateToCreateGroupFanout']);
        }

        if (!isArray(args.inputs)) {
          return cbk([400, 'ExpectedArrayOfUtxosToCreateGroupFanout']);
        }

        return cbk();
      },

      // Get the on-chain balance to sanity check group creation
      getBalance: ['validate', ({}, cbk) => {
        return getChainBalance({lnd: args.lnd}, cbk);
      }],

      // Get identity public key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd: args.lnd}, cbk)],

      // Get methods to confim partial signing is supported
      getMethods: ['validate', ({}, cbk) => getMethods({lnd: args.lnd}, cbk)],

      // Sanity check the on-chain balance is reasonable to create a group
      confirmBalance: ['getBalance', ({getBalance}, cbk) => {
        const capacity = args.capacity * args.output_count;

        if (capacity > getBalance.chain_balance) {
          return cbk([400, 'ExpectedCapacityLowerThanCurrentChainBalance']);
        }

        return cbk();
      }],

      // Make sure that partially signing a PSBT is a known method
      confirmSigner: ['getMethods', ({getMethods}, cbk) => {
        if (!getMethods.methods.find(n => n.endpoint === signPsbtEndpoint)) {
          return cbk([400, 'ExpectedLndSupportingPartialPsbtSigning']);
        }

        return cbk();
      }],

      // Fund and assemble the group
      create: [
        'ecp',
        'confirmBalance',
        'confirmSigner',
        'getBalance',
        'getIdentity',
        ({ecp, getIdentity}, cbk) =>
      {
        const announced = [];
        const members = [getIdentity.public_key].concat(args.members);

        const coordinate = assembleFanoutGroup({
          ecp,
          capacity: args.capacity,
          count: args.count,
          identity: getIdentity.public_key,
          inputs: args.inputs,
          lnd: args.lnd,
          members: !!args.members.length ? members : undefined,
          output_count: args.output_count,
          rate: args.rate,
        });

        const code = getIdentity.public_key + coordinate.id;

        args.logger.info({group_invite_code: code});

        // Members will join the group
        coordinate.events.on('present', async ({id}) => {
          const alreadyAnnounced = announced.slice().reverse().find(node => {
            return node.id === id;
          });

          // Exit early when already announced
          if (!!alreadyAnnounced && (now() - alreadyAnnounced.at) < staleMs) {
            return;
          }

          announced.push({at: now(), id});

          // Maintain a fixed size of announced members
          if (announced.length > args.count) {
            announced.shift();
          }

          const joined = await getNodeAlias({id, lnd: args.lnd});

          return args.logger.info({at: new Date(), ready: niceName(joined)});
        });

        // The group must fill up with participants first
        coordinate.events.once('filled', async ({ids}) => {
          const members = ids.filter(n => n !== getIdentity.public_key);

          const nodes = await asyncMap(members, async id => {
            return niceName(await getNodeAlias({id, lnd: args.lnd}));
          });

          return args.logger.info({ready: join(nodes)});
        });

        // Once filled, members will connect with their partners
        coordinate.events.once('connected', () => {
          return args.logger.info({peered: true});
        });

        // Members will propose pending channels to each other
        coordinate.events.once('proposed', () => {
          return args.logger.info({proposed: true});
        });

        // Once all pending channels are in place, signatures will be received
        coordinate.events.once('signed', () => {
          return args.logger.info({signed: true});
        });

        // Finally the open channel tx will be broadcast
        coordinate.events.once('broadcasting', broadcast => {
          return args.logger.info({publishing: broadcast.transaction});
        });

        // After broadcasting the channels transaction needs to confirm
        coordinate.events.once('broadcast', broadcast => {
          coordinate.events.removeAllListeners();

          args.logger.info({transaction_id: broadcast.id});

          return broadcastTransaction({
            description: descriptionForGroup,
            lnd: args.lnd,
            logger: args.logger,
            transaction: broadcast.transaction,
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, {transaction_id: broadcast.id});
          });
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
