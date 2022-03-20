const asyncAuto = require('async/auto');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const convertFiat = require('./convert_fiat');
const createAnchoredTrade = require('./create_anchored_trade');
const finalizeTrade = require('./finalize_trade');
const serviceOpenTrade = require('./service_open_trade');

const asNumber = n => parseFloat(n, 10);
const daysAsMs = days => Number(days) * 1000 * 60 * 60 * 24;
const defaultExpirationDays = 1;
const defaultFiatInvoiceExpiryMs = 1000 * 60 * 30;
const {floor} = Math;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const isNumber = n => !isNaN(n);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const maxDescriptionLength = 100;
const maxSecretLength = 100;
const priceFiat = 'set-price-fiat';
const priceTokens = 'set-price-tokens';
const uriAsSocket = n => n.substring(67);
const usdAsPrice = ({usd}) => `${usd}*USD`;
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
          message: 'What is the secret you want to sell?',
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

      // Select pricing type
      selectPriceType: [
        'askForNodeId',
        'askForSecret',
        ({askForNodeId}, cbk) =>
      {
        // Exit early and force absolute price when this is a direct trade
        if (!!askForNodeId.id) {
          return cbk(null, {type: priceTokens});
        }

        return ask({
          choices: [
            {name: 'Set absolute price', value: priceTokens},
            {name: 'Set dynamic price in fiat terms (USD)', value: priceFiat},
          ],
          message: '?',
          name: 'type',
          type: 'list',
        },
        cbk);
      }],

      // Ask for the fiat price of the secret
      askForFiatPrice: ['selectPriceType', ({selectPriceType}, cbk) => {
        // Exit early when not setting a fiat price
        if (selectPriceType.type !== priceFiat) {
          return cbk();
        }

        return ask({
          default: '0.01',
          message: 'Dollars USD to charge?',
          name: 'usd',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // Price of sale should be numeric
            if (!isNumber(input)) {
              return 'Not a number of dollars, try a number?';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for the price of the secret
      askForTokensPrice: ['selectPriceType', ({selectPriceType}, cbk) => {
        // Exit early when not asking for an absolute price
        if (selectPriceType.type !== priceTokens) {
          return cbk();
        }

        return ask({
          default: '1',
          message: 'Amount to charge?',
          name: 'tokens',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // Price of sale should be numeric
            if (!isNumber(input)) {
              return 'Not a number, try a number?';
            }

            // Disallow fractional values
            if (!!isNumber(input) && floor(input) !== asNumber(input)) {
              return 'Specified precision not supported';
            }

            return true;
          },
        },
        cbk);
      }],

      // Ask for the expiration of the trade
      askForExpiration: ['askForFiatPrice', 'askForTokensPrice', ({}, cbk) => {
        return ask({
          default: defaultExpirationDays,
          name: 'days',
          message: 'Days to offer this for?',
          validate: input => {
            // Days must be a number
            if (!isNumber(input) || !Number(input)) {
              return false;
            }

            return true;
          },
        },
        cbk);
      }],

      // Get the conversion to tokens for fiat
      getTokens: ['askForFiatPrice', ({askForFiatPrice}, cbk) => {
        // Exit early if not using fiat
        if (!askForFiatPrice) {
          return cbk();
        }

        // Check that the fiat price can be converted
        return convertFiat({request, price: usdAsPrice(askForFiatPrice)}, cbk);
      }],

      // Create an anchor invoice for the trade
      createAnchor: [
        'askForDescription',
        'askForExpiration',
        'askForFiatPrice',
        'askForNodeId',
        'askForSecret',
        'askForTokensPrice',
        'getTokens',
        ({
          askForDescription,
          askForExpiration,
          askForFiatPrice,
          askForNodeId,
          askForSecret,
          askForTokensPrice,
        },
        cbk) =>
      {
        // Exit early if this is a closed trade
        if (!!askForNodeId.id) {
          return cbk();
        }

        // Tokens may be undefined when fiat price is set
        const {tokens} = !!askForTokensPrice ? askForTokensPrice : {};

        return createAnchoredTrade({
          lnd,
          tokens,
          description: askForDescription.description,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          price: !!askForFiatPrice ? usdAsPrice(askForFiatPrice) : undefined,
          secret: askForSecret.secret,
        },
        cbk);
      }],

      // Wait for a peer to connect and ask for the trade details
      serviceTradeRequests: [
        'askForDescription',
        'askForExpiration',
        'askForFiatPrice',
        'askForNodeId',
        'askForSecret',
        'askForTokensPrice',
        'createAnchor',
        'getChannels',
        'getIdentity',
        'getNetwork',
        ({
          askForDescription,
          askForExpiration,
          askForFiatPrice,
          askForNodeId,
          askForSecret,
          askForTokensPrice,
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
          price: !!askForFiatPrice ? usdAsPrice(askForFiatPrice) : undefined,
          public_key: getIdentity.public_key,
          secret: askForSecret.secret,
          tokens: (!!askForTokensPrice ? askForTokensPrice : {}).tokens,
          uris: (getIdentity.uris || []),
        },
        cbk);
      }],

      // Finalize the trade with an encrypted secret and an invoice
      finalize: [
        'askForDescription',
        'askForExpiration',
        'askForNodeId',
        'askForSecret',
        'askForTokensPrice',
        ({
          askForDescription,
          askForExpiration,
          askForNodeId,
          askForSecret,
          askForTokensPrice,
        },
        cbk) =>
      {
        // Exit early when there is no node to finalize the trade to
        if (!askForNodeId.id) {
          return cbk();
        }

        return finalizeTrade({
          lnd,
          description: askForDescription.description,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          secret: askForSecret.secret,
          to: askForNodeId.id,
          tokens: asNumber(askForTokensPrice.tokens),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'finalize'}, cbk));
  });
};
