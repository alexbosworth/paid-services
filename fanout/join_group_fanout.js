const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getMethods} = require('ln-service');
const {getUtxos} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const joinFanout = require('./join_fanout');
const getJoinDetails = require('./get_join_details');

const asBigUnit = n => (n / 1e8).toFixed(8);
const asOutpoint = utxo => `${utxo.transaction_id}:${utxo.transaction_vout}`;
const formatNodes = arr => arr.join(', ');
const {isArray} = Array;
const isCode = n => !!n && n.length === 98;
const isNumber = n => !isNaN(n);
const nestedSegWitAddressFormat = 'np2wpkh';
const niceName = ({alias, id}) => `${alias} ${id}`.trim();
const signPsbtEndpoint = '/walletrpc.WalletKit/SignPsbt';
const sumOf = arr => arr.reduce((sum, n) => sum + n, Number());

/** Join a fanout group

  {
    ask: <Ask Function>
    code: <Group Invite Code String>
    [inputs]: [<Utxo Outpoint String>]
    [is_selecting_utxos]: <Interactively Select UTXOs to Spend Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    max_rate: <Max Opening Chain Fee Tokens Per VByte Fee Rate Number>
    output_count: <Output Count Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Fanout Funding Transaction Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToJoinGroupFanout']);
        }

        if (!isArray(args.inputs)) {
            return cbk([400, 'ExpectedArrayOfUtxosToJoinGroupFanout']);
        }

        if (!isCode(args.code)) {
          return cbk([400, 'ExpectedValidJoinCodeToJoinGroupFanout']);
        }

        if (!args.inputs.length && !args.is_selecting_utxos) {
          return cbk([400, 'ExpectedToSelectUtxosToJoinGroupFanout']);
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

      // Get UTXOs to use for input selection and final fee rate calculation
      getUtxos: ['validate', ({}, cbk) => getUtxos({lnd: args.lnd}, cbk)],

      // Make sure that partially signing a PSBT is valid
      confirmSigner: ['getMethods', ({getMethods}, cbk) => {
        if (!getMethods.methods.find(n => n.endpoint === signPsbtEndpoint)) {
          return cbk([400, 'ExpectedLndSupportingPartialPsbtSigningToJoin']);
        }

        return cbk();
      }],

      // Select inputs to spend
      utxos: ['getUtxos', ({getUtxos}, cbk) => {
        // Exit early when UTXOs are all specified already
        if (!!args.inputs.length) {
          return cbk(null, args.inputs);
        }

        // Exit early when not selecting UTXOs interactively
        if (!args.is_selecting_utxos) {
          return cbk(null, []);
        }

        // Only selecting confirmed utxos is supported
        const utxos = getUtxos.utxos
        .filter(n => !!n.confirmation_count)
        .filter(n => n.address_format !== nestedSegWitAddressFormat);

        // Make sure there are some UTXOs to select
        if (!utxos.length) {
          return cbk([400, 'WalletHasZeroConfirmedUtxos']);
        }

        return args.ask({
          choices: utxos.map(utxo => ({
            name: `${asBigUnit(utxo.tokens)} ${asOutpoint(utxo)}`,
            value: asOutpoint(utxo),
          })),
          loop: false,
          name: 'inputs',
          type: 'checkbox',
          validate: input => {
            // A selection is required
            if (!input.length) {
              return false;
            }

            const tokens = sumOf(input.map(utxo => {
              return utxos.find(n => asOutpoint(n) === utxo.value).tokens;
            }));

            const capacity = args.capacity * args.output_count;

            const missingTok = asBigUnit(capacity - tokens);

            if (tokens < capacity) {
              return `Selected ${asBigUnit(tokens)}, need ${missingTok} more`;
            }

            return true;
          }
        },
        ({inputs}) => cbk(null, inputs));
      }],

      // Decode the group invite code and get group details
      getJoinDetails: ['confirmSigner', 'utxos', ({}, cbk) => {
        return getJoinDetails({
          code: args.code,
          lnd: args.lnd,
          logger: args.logger,
          output_count: args.output_count,
        },
        cbk);
      }],

      // Join the Fanout group
      join: [
        'confirmSigner',
        'getMethods',
        'getJoinDetails',
        'utxos',
        ({getJoinDetails, utxos}, cbk) =>
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
          inputs: utxos,
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

        // Once everyone is peered to the coordinator then the fanout tx is made
        join.once('publishing', ({refund, signed}) => {
          return args.logger.info({refund, signed});
        });

        return;
      }],
    },
    returnResult({reject, resolve, of: 'join'}, cbk));
  });
};
