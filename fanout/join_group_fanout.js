const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getMethods} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const joinFanout = require('./join_fanout');
const getJoinDetails = require('./get_join_details');

const formatNodes = arr => arr.join(', ');
const {isArray} = Array;
const isCode = n => !!n && n.length === 98;
const isNumber = n => !isNaN(n);
const niceName = ({alias, id}) => `${alias} ${id}`.trim();
const signPsbtEndpoint = '/walletrpc.WalletKit/SignPsbt';

/** Join a fanout group

  {
    code: <Group Invite Code String>
    [inputs]: [<Utxo Outpoint String>]
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_rate: <Max Opening Chain Fee Tokens Per VByte Fee Rate Number>
    output_count: <Output Count Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Channel Funding Transaction Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.inputs)) {
            return cbk([400, 'ExpectedArrayOfUtxosToJoinGroupFanout']);
        }

        if (!isCode(args.code)) {
          return cbk([400, 'ExpectedValidJoinCodeToJoinGroupFanout']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToJoinGroupFanout']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToJoinGroupFanout']);
        }

        if (!args.max_rate) {
          return cbk([400, 'ExpectedMaxOpeningFeeRateToJoinGroupFanout']);
        }

        if (!args.output_count || !isNumber(args.output_count)) {
          return cbk([400, 'ExpectedOutputCountToJoinGroupFanout']);
        }

        return cbk();
      },

      // Get methods to confim partial signing is supported
      getMethods: ['validate', ({}, cbk) => getMethods({lnd: args.lnd}, cbk)],

      // Make sure that partially signing a PSBT is valid
      confirmSigner: ['getMethods', ({getMethods}, cbk) => {
        if (!getMethods.methods.find(n => n.endpoint === signPsbtEndpoint)) {
          return cbk([400, 'ExpectedLndSupportingPartialPsbtSigningToJoin']);
        }

        return cbk();
      }],

      // Decode the group invite code and get group details
      getJoinDetails: ['confirmSigner', ({}, cbk) => {
        return getJoinDetails({
          code: args.code,
          lnd: args.lnd,
          logger: args.logger,
          output_count: args.output_count,
        },
        cbk);
      }],

      // Join the channel group
      join: [
        'confirmSigner',
        'getMethods',
        'getJoinDetails',
        ({getJoinDetails}, cbk) =>
      {
        if (getJoinDetails.rate > args.max_rate) {
          return cbk([
            400,
            'ExpectedHigherMaxFeeRateToJoinGroup',
            {needed_max_fee_rate: getJoinDetails.rate},
          ]);
        }

        args.logger.info({waiting_for_other_members: true});

        const join = joinFanout({
          capacity: getJoinDetails.capacity,
          coordinator: getJoinDetails.coordinator,
          count: getJoinDetails.count,
          id: getJoinDetails.id,
          inputs: args.inputs,
          lnd: args.lnd,
          output_count: args.output_count,
          rate: getJoinDetails.rate,
        });

        join.once('end', ({id}) => cbk(null, {transaction_id: id}));
        join.once('error', err => cbk(err));

        // After the group is filled the members are matched and peer up
        join.once('peering', async ({inbound, outbound}) => {
          const nodes = await asyncMap([inbound, outbound], async id => {
            return niceName(await getNodeAlias({id, lnd: args.lnd}));
          });

          return args.logger.info({peering_with: formatNodes(nodes)});
        });

        // Once everyone is peered then the channel tx is made
        join.once('publishing', ({refund, signed}) => {
          return args.logger.info({refund, signed});
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'join'}, cbk));
  });
};
