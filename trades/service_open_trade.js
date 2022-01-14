const asyncAuto = require('async/auto');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const encodeOpenTrade = require('./encode_open_trade');
const serviceTradeRequests = require('./service_trade_requests');

const asNumber = n => parseFloat(n, 10);
const {isArray} = Array;
const nodeName = (alias, id) => `${alias} ${id}`;
const slowTradeDate = () => new Date(Date.now() + (86400000*15)).toISOString();
const uriAsSocket = n => n.substring(67);

/** Service an individual trade

  {
    channels: [{
      id: <Standard Format Channel Id String>
      partner_public_key: <Node Public Key Hex String>
    }]
    description: <Trade Description String>
    expires_at: <Expires At ISO 8601 Date String>
    id: <Trade Anchor Id Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    network: <Network Name String>
    public_key: <Identity Public Key Hex String>
    secret: <Secret to Sell String>
    tokens: <Trade Price Tokens Number>
    uris: [<Node URI String>]
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.channels)) {
          return cbk([400, 'ExpectedArrayOfChannelsToServiceTrade']);
        }

        if (!args.description) {
          return cbk([400, 'ExpectedDescriptionToServiceTrade']);
        }

        if (!args.expires_at) {
          return cbk([400, 'ExpectedExpiresAtDateToServiceTrade']);
        }

        if (!args.id) {
          return cbk([400, 'ExpectedTradeAnchorIdToServiceTrade']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToServiceTrade']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToServiceTrade']);
        }

        if (!args.network) {
          return cbk([400, 'ExpectedNetworkNameToServiceTrade']);
        }

        if (!args.public_key) {
          return cbk([400, 'ExpectedIdentityPublicKeyToServiceTrade']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedSecretToSellToServiceTrade']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensPriceToServiceTrade']);
        }

        if (!isArray(args.uris)) {
          return cbk([400, 'ExpectedArrayOfNodeSocketUrisToServiceTrade']);
        }

        return cbk();
      },

      // Serve the trade
      serve: ['validate', ({}, cbk) => {
        const isSlowTrade = args.expires_at > slowTradeDate();
        const settled = [];

        // Encode the open trade details to give out
        const openTrade = encodeOpenTrade({
          network: args.network,
          nodes: [{
            channels: isSlowTrade ? [] : args.channels,
            id: args.public_key,
            sockets: !args.channels.length ? args.uris.map(uriAsSocket) : [],
          }],
        });

        args.logger.info({trade_expiry: new Date(args.expires_at)});

        const sub = serviceTradeRequests({
          description: args.description,
          expires_at: args.expires_at,
          id: args.id,
          lnd: args.lnd,
          secret: args.secret,
          tokens: asNumber(args.tokens),
        });

        // Someone asked for trade details
        sub.on('details', async ({to}) => {
          try {
            const {alias, id} = await getNodeAlias({id: to, lnd: args.lnd});

            const toName = nodeName(alias, id);

            return args.logger.info({return_trade_info_to: toName});
          } catch (err) {
            return args.logger.error({err});
          }
        });

        sub.on('failure', failure => args.logger.error({failure}));

        sub.on('settled', ({to}) => settled.push(to));

        sub.on('trade', async ({to}) => {
          try {
            const {alias, id} = await getNodeAlias({id: to, lnd: args.lnd});

            const toName = nodeName(alias, id);

            return args.logger.info({make_trade_invoice_for: toName});
          } catch (err) {
            return args.logger.error({err});
          }
        });

        // Show the trade details blob
        return args.logger.info({
          waiting_for_trade_request_to: openTrade.trade,
        });

        // Wait for the trade to end
        sub.once('end', async () => {
          try {
            const [to] = settled;

            // Exit early when there was no settlement
            if (!to) {
              args.logger.info({trade_ended: true});

              return cbk();
            }

            const {alias, id} = await getNodeAlias({id: to, lnd: args.lnd});

            args.logger.info({finished_trade_with: nodeName(alias, id)});
          } catch (err) {
            args.logger.error({err});
          } finally {
            return cbk();
          }
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
