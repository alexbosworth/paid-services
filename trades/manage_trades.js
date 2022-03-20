const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {cancelHodlInvoice} = require('ln-service');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getInvoices} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const buyChannel = require('./buy_channel');
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
    request: <Request Function>
    separator: <Create Separator Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger, request, separator}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToManageTrades']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageTrades']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToManageTrades']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToManageTrades']);
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
            {name: 'Buy Secret', value: decodeAction},
            {
              name: 'Buy Channel (experimental)',
              value: buyAction,
            },
            separator(),
            {name: 'Sell Secret', value: createAction},
            {
              name: 'Sell Channel (experimental)',
              value: sellAction,
            },
            separator(),
            {name: 'List Open Trades', value: listAction},
            {name: 'Serve Open Trades', value: serveAction},
          ],
          loop: false,
          message: 'Trade?',
          name: 'action',
          type: 'list',
        },
        cbk);
      }],

      // Confirm that signer RPC is enabled, this is required for trade secret
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

        return createTrade({ask, lnd, logger, request}, cbk);
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
        if (select.action !== decodeAction) {
          return cbk();
        }

        return manageTrade({ask, lnd, logger}, cbk)
      }],

      // Buy a channel
      buyChannel: ['select', ({select}, cbk) => {
        // Exit early when not buying a channel
        if (select.action !== buyAction) {
          return cbk();
        }

        return buyChannel({ask, lnd, logger}, cbk);
      }],

      // Get open trades that are being offered
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

        const trades = getTrades.filter(n => !!n.secret && !!n.description);

        return ask({
          choices: trades.map(({description, id, price, tokens}) => {
            const charging = !!tokens ? tokensAsBigUnit(tokens) : price;

            return {name: `${charging} ${description}`, value: id};
          }),
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
          request,
          channels: [],
          description: trade.description,
          expires_at: trade.expires_at,
          id: trade.id,
          network: getNetwork.network,
          price: trade.price,
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

        const sub = serviceAnchoredTrades({lnd, request});

        const {trade} = encodeTrade({
          connect: {
            network: getNetwork.network,
            nodes: [{channels: [], id: getIdentity.public_key, sockets: []}],
          },
        });

        logger.info({servicing_all_open_trades: trade});

        sub.on('settled', async ({description, to, tokens}) => {
          const {alias, id} = await getNodeAlias({lnd, id: to});

          const item = `${description} to ${alias} ${to}`;

          return logger.info(`sold: ${tokensAsBigUnit(tokens)} ${item}`);
        });

        sub.on('start', ({description, price, tokens}) => {
          const amount = !!tokens ? tokensAsBigUnit(tokens) : price;

          const trade = `${amount} ${description}`;

          return logger.info(`open: ${trade}`);
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

        return createChannelSale({ask, lnd, logger, request}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
