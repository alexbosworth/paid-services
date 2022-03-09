const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {cancelHodlInvoice} = require('ln-service');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const createChannelSale = require('./create_channel_sale');
const createTrade = require('./create_trade');
const encodeTrade = require('./encode_trade');
const manageTrade = require('./manage_trade');
const serviceAnchoredTrades = require('./service_anchored_trades');
const serviceOpenTrade = require('./service_open_trade');
const tradeFromInvoice = require('./trade_from_invoice');

const buyAction = 'buy';
const cancelAction = 'cancel-';
const createAction = 'create';
const decodeAction = 'decode';
const defaultInvoicesLimit = 100;
const listAction = 'list';
const sellAction = 'sell';
const serveAction = 'serve';
const serveTradeAction = 'serve-trade-';
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const viewAction = 'view';

/** Create, view, and accept trades

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    separator: <Create Separator Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, balance, lnd, logger, separator}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToManageTrades']);
        }

        if (balance === undefined) {
          return cbk([400, 'ExpectedChainBalanceToManageTrades']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageTrades']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToManageTrades']);
        }

        return cbk();
      },

      // Get node identity
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Select a trade option
      select: ['validate', ({}, cbk) => {
        return ask({
          choices: [
            separator(),
            {name: 'Buy Channel', value: buyAction},
            {name: 'Sell Channel', value: sellAction},
            separator(),
            {name: 'Create Trade', value: createAction},
            {name: 'Decode Trade', value: decodeAction},
            separator(),
            {name: 'Open Trades', value: listAction},
            {name: 'Serve Trades', value: serveAction},
          ],
          message: 'Trade?',
          name: 'action',
          type: 'list',
        },
        cbk);
      }],

      // Confirm that signer RPC is enabled
      checkSigner: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Create a new trade
      create: ['select', ({select}, cbk) => {
        // Exit early when not creating a new trade
        if (select.action !== createAction) {
          return cbk();
        }

        return createTrade({ask, lnd, logger}, cbk);
      }],

      // Trade was created
      created: ['create', ({create}, cbk) => {
        // Exit early when not creating a new trade
        if (!create) {
          return cbk();
        }

        logger.info({encoded_trade_created: create.trade});

        return cbk();
      }],

      // View an existing trade
      view: ['checkSigner', 'select', ({checkSigner, select}, cbk) => {
        // Exit early when not decoding a trade
        if (select.action !== decodeAction && select.action !== buyAction) {
          return cbk();
        }

        return manageTrade({ask, lnd, logger, action: select.action}, cbk)
      }],

      // Get open trades
      getTrades: ['validate', ({}, cbk) => {
        const paging = {trades: []};

        // Find open anchored trades
        asyncUntil(
          cbk => cbk(null, paging.token === false),
          cbk => {
            return getInvoices({
              lnd,
              is_unconfirmed: true,
              limit: !paging.token ? defaultInvoicesLimit : undefined,
              token: paging.token,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              paging.token = res.next || false;

              res.invoices
                .map(tradeFromInvoice)
                .map(n => n.trade)
                .filter(n => !!n)
                .forEach(n => paging.trades.push(n));

              return cbk();
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            return cbk(null, paging.trades);
          }
        );
      }],

      // List open trades
      list: ['getTrades', 'select', ({getTrades, select}, cbk) => {
        // Exit early when not viewing open trades
        if (select.action !== listAction) {
          return cbk();
        }

        if (!getTrades.length) {
          return cbk([404, 'NoTradesCurrentlyOpen']);
        }

        return ask({
          choices: getTrades.map(trade => ({
            name: `${tokensAsBigUnit(trade.tokens)} ${trade.description}`,
            value: trade.id,
          })),
          message: 'Trade?',
          name: 'manage',
          type: 'list',
        },
        cbk);
      }],

      // Manage an open trades
      manage: ['getTrades', 'list', ({getTrades, list}, cbk) => {
        // Exit early when not viewing open trades
        if (!list) {
          return cbk();
        }

        return ask({
          choices: [
            {name: 'Serve Trade', value: `${serveTradeAction}${list.manage}`},
            separator(),
            {name: 'Cancel Trade', value: `${cancelAction}${list.manage}`},
          ],
          message: 'Trade?',
          name: 'trade',
          type: 'list',
        },
        cbk);
      }],

      // Service an open trade
      serviceTrade: [
        'getIdentity',
        'getNetwork',
        'getTrades',
        'manage',
        ({getIdentity, getNetwork, getTrades, manage}, cbk) =>
      {
        // Exit early when this is not cancel of an open trade
        if (!manage || !manage.trade.startsWith(serveTradeAction)) {
          return cbk();
        }

        const id = manage.trade.slice(serveTradeAction.length);

        const trade = getTrades.find(n => n.id === id);

        return serviceOpenTrade({
          lnd,
          logger,
          channels: [],
          description: trade.description,
          expires_at: trade.expires_at,
          id: trade.id,
          network: getNetwork.network,
          public_key: getIdentity.public_key,
          secret: trade.secret,
          tokens: trade.tokens,
          uris: [],
        },
        cbk);
      }],

      // Cancel an open trade
      cancelTrade: ['manage', ({manage}, cbk) => {
        // Exit early when this is not cancel of an open trade
        if (!manage || !manage.trade.startsWith(cancelAction)) {
          return cbk();
        }

        return cancelHodlInvoice({
          lnd,
          id: manage.trade.slice(cancelAction.length),
        },
        cbk);
      }],

      // Serve open trades
      service: [
        'getIdentity',
        'getNetwork',
        'select',
        ({getIdentity, getNetwork, select}, cbk) =>
      {
        // Exit early when not serving trades
        if (select.action !== serveAction) {
          return cbk();
        }

        const sub = serviceAnchoredTrades({lnd});

        const {trade} = encodeTrade({
          connect: {
            network: getNetwork.network,
            nodes: [{channels: [], id: getIdentity.public_key, sockets: []}],
          },
        });

        logger.info({servicing_all_open_trades: trade});

        sub.on('settled', async ({description, to, tokens}) => {
          const {alias, id} = await getNodeAlias({lnd, id: to});

          return logger.info(`sold: ${tokensAsBigUnit(tokens)} ${description} to ${alias} ${to}`);
        });

        sub.on('start', ({description, tokens}) => {
          return logger.info(`open: ${tokensAsBigUnit(tokens)} ${description}`);
        });

        sub.on('error', err => {
          sub.removeAllListeners();

          return cbk(err);
        });
      }],

      // Sell a channel
      sellChannel: ['select', ({select}, cbk) => {
        // Exit early when not selling a channel
        if (select.action !== sellAction) {
          return cbk();
        }

        return createChannelSale({
          balance,
          ask,
          lnd,
          logger,
          action: select.action,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
