const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const createAnchoredTrade = require('./create_anchored_trade');
const finalizeTradeSecret = require('./finalize_trade_secret');
const serviceOpenTrade = require('./service_open_trade');

const asNumber = n => parseFloat(n, 10);
const daysAsMs = days => Number(days) * 1000 * 60 * 60 * 24;
const defaultExpirationDays = 14;
const {floor} = Math;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxDescriptionLength = 100;
const maxSecretLength = 100;
const uriAsSocket = n => n.substring(67);
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Create a new trade

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({ask, lnd, logger, request}, cbk) => {
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

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToCreateTrade']);
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

      // Ask for the expiration of the trade
      askForExpiration: ['askForPrice', ({}, cbk) => {
        return ask({
          default: defaultExpirationDays,
          name: 'days',
          message: 'Days to offer this for?',
          validate: input => {
            if (!isNumber(input) || !Number(input)) {
              return false;
            }

            return true;
          },
        },
        cbk);
      }],

      // Create an anchor invoice for the trade
      createAnchor: [
        'askForDescription',
        'askForExpiration',
        'askForNodeId',
        'askForPrice',
        'askForSecret',
        ({
          askForDescription,
          askForExpiration,
          askForNodeId,
          askForPrice,
          askForSecret,
        },
        cbk) =>
      {
        // Exit early if this is a closed trade
        if (!!askForNodeId.id) {
          return cbk();
        }

        return createAnchoredTrade({
          lnd,
          description: askForDescription.description,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          secret: askForSecret.secret,
          tokens: asNumber(askForPrice.tokens),
        },
        cbk);
      }],

      // Wait for a peer to connect and ask for the trade details
      serviceTradeRequests: [
        'askForDescription',
        'askForExpiration',
        'askForNodeId',
        'askForPrice',
        'askForSecret',
        'createAnchor',
        'getChannels',
        'getIdentity',
        'getNetwork',
        ({
          askForDescription,
          askForExpiration,
          askForNodeId,
          askForPrice,
          askForSecret,
          createAnchor,
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

        return serviceOpenTrade({
          lnd,
          logger,
          request,
          channels: getChannels.channels,
          description: askForDescription.description,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          id: createAnchor.id,
          network: getNetwork.network,
          public_key: getIdentity.public_key,
          secret: askForSecret.secret,
          tokens: asNumber(askForPrice.tokens),
          uris: (getIdentity.uris || []),
        },
        cbk);
      }],

      // Finalize the trade with an encrypted secret and an invoice
      finalize: [
        'askForDescription',
        'askForExpiration',
        'askForNodeId',
        'askForPrice',
        'askForSecret',
        ({
          askForDescription,
          askForExpiration,
          askForNodeId,
          askForPrice,
          askForSecret,
        },
        cbk) =>
      {
        // Exit early when there is no node to finalize the trade to
        if (!askForNodeId.id) {
          return cbk();
        }

        return finalizeTradeSecret({
          lnd,
          description: askForDescription.description,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
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
