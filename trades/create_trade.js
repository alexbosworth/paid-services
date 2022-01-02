const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getNodeAlias} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const encodeOpenTrade = require('./encode_open_trade');
const finalizeTradeSecret = require('./finalize_trade_secret');
const serviceTradeRequests = require('./service_trade_requests');

const asNumber = n => parseFloat(n, 10);
const {floor} = Math;
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxDescriptionLength = 100;
const maxSecretLength = 100;
const nodeName = (alias, id) => `${alias} ${id}`;
const uriAsSocket = n => n.substring(67);
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Create a new trade

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateTrade']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToCreateTrade']);
        }

        return cbk();
      },

      // Get the node identity key
      getIdentity: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Ask for the public key of the node to trade with
      askForNodeId: ['getIdentity', ({getIdentity}, cbk) => {
        return ask({
          name: 'id',
          message: 'Public key of node you are trading with? (Optional)',
          type: 'input',
          validate: input => {
            if (!input) {
              return true;
            }

            if (!isPublicKey(input)) {
              return 'Expected public key of node to trade with';
            }

            if (input === getIdentity.public_key) {
              return 'Expected public key of other node';
            }

            return true;
          },
        },
        cbk);
      }],

      // Get the public channels to use for an open trade
      getChannels: ['askForNodeId', ({askForNodeId}, cbk) => {
        // Exit early when there is a specific node
        if (!!askForNodeId.id) {
          return cbk();
        }

        return getChannels({lnd, is_public: true}, cbk);
      }],

      // Get the network name to use for an open trade
      getNetwork: ['askForNodeId', ({askForNodeId}, cbk) => {
        // Exit early when there is a specific node
        if (!!askForNodeId.id) {
          return cbk();
        }

        return getNetwork({lnd}, cbk);
      }],

      // Ask for how to describe the payload
      askForDescription: ['askForNodeId', ({}, cbk) => {
        return ask({
          name: 'description',
          message: `Describe the secret you are offering:`,
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            if (input.length > maxDescriptionLength) {
              return 'Expected shorter description';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for the actual payload of the trade
      askForSecret: ['askForDescription', ({askForDescription}, cbk) => {
        return ask({
          name: 'secret',
          message: 'Enter the secret you want to sell',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            if (input.length > maxSecretLength) {
              return 'Expected shorter secret value';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for the price of the secret
      askForPrice: ['askForSecret', ({}, cbk) => {
        return ask({
          name: 'tokens',
          message: 'How much do you want to charge?',
          validate: input => {
            // Only allow numeric input
            if (!isNumber(input)) {
              return false;
            }

            // Disallow fractional values
            if (floor(input) !== asNumber(input)) {
              return 'Specified precision not supported';
            }

            return true;
          },
        },
        cbk);
      }],

      // Wait for a peer to connect and ask for the trade details
      serviceTradeRequests: [
        'askForDescription',
        'askForNodeId',
        'askForPrice',
        'askForSecret',
        'getChannels',
        'getIdentity',
        'getNetwork',
        ({
          askForDescription,
          askForNodeId,
          askForPrice,
          askForSecret,
          getChannels,
          getIdentity,
          getNetwork,
        },
        cbk) =>
      {
        // Exit early if this is a closed trade
        if (!!askForNodeId.id) {
          return cbk();
        }

        // Encode the open trade details to give out
        const openTrade = encodeOpenTrade({
          network: getNetwork.network,
          nodes: [{
            channels: getChannels.channels,
            id: getIdentity.public_key,
            sockets: (getIdentity.uris || []).map(uriAsSocket),
          }],
        });

        const settled = [];

        const sub = serviceTradeRequests({
          lnd,
          description: askForDescription.description,
          secret: askForSecret.secret,
          tokens: asNumber(askForPrice.tokens),
        });

        sub.on('details', async ({to}) => {
          const {alias, id} = await getNodeAlias({lnd, id: to});

          return logger.info({return_trade_info_to: nodeName(alias, id)});
        });

        sub.once('end', async () => {
          const [to] = settled;

          if (!!to) {
            const {alias, id} = await getNodeAlias({lnd, id: to});

            return logger.info({finished_trade_with: nodeName(alias, id)});
          }

          return cbk();
        });

        sub.on('failure', failure => logger.error({failure}));

        sub.on('settled', ({to}) => settled.push(to));

        sub.on('trade', async ({to}) => {
          const {alias, id} = await getNodeAlias({lnd, id: to});

          return logger.info({make_trade_invoice_for: nodeName(alias, id)});
        });

        // Show the trade details blob
        return logger.info({waiting_for_trade_request_to: openTrade.trade});
      }],

      // Finalize the trade with an encrypted secret and an invoice
      finalize: [
        'askForDescription',
        'askForNodeId',
        'askForPrice',
        'askForSecret',
        ({askForDescription, askForNodeId, askForPrice, askForSecret}, cbk) =>
      {
        // Exit early when there is no node to finalize the trade to
        if (!askForNodeId.id) {
          return cbk();
        }

        return finalizeTradeSecret({
          lnd,
          description: askForDescription.description,
          secret: askForSecret.secret,
          to: askForNodeId.id,
          tokens: asNumber(askForPrice.tokens),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'finalize'}, cbk));
  });
};
