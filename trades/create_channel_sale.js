const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {signMessage} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const convertFiatToBtc = require('./convert_fiat_to_btc');
const createAnchoredTrade = require('./create_anchored_trade');
const serviceOpenTrade = require('./service_open_trade');

const asNumber = n => parseFloat(n, 10);
const daysAsMs = days => Number(days) * 1000 * 60 * 60 * 24;
const defaultExpirationDays = 1;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const hasFiat = n => /(aud|cad|eur|gbp|inr|jpy|usd)/gim.test(n);
const isNumber = n => !isNaN(n);
const query = 'How much would you like to sell?';
const saleCost = (amount, rate) => (amount * rate / 1000000).toFixed(0);
const saleSecret = randomBytes(48).toString('hex');
const tradeDescription = (alias, tokens) => `channelsale:${alias}-${tokens}`;

/** Create a new channel sale

  {
    action: <Channel Sale Action String>
    ask: <Ask Function>
    balance: <Total Available Chain Confirmed Balance Tokens Number>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({action, ask, balance, lnd, logger, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!action) {
          return cbk([400, 'ExpectedActionTypeToCreateChannelSale']);
        }

        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateChannelSale']);
        }

        if (balance === undefined) {
          return cbk([400, 'ExpectedOnChainBalanceToCreateChannelSale']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToCreateChannelSale']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToCreateChannelSale']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToCreateChannelSale']);
        }

        return cbk();
      },

      // Get the public channels to use for an open trade
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd, is_public: true}, cbk);
      }],

      // Get self identity, including alias
      getIdentity: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Get the network name to use for an open trade
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Ask for sale amount
      askForAmount: ['validate', ({}, cbk) => {
        return ask({
          message: `${query} (Available balance: ${balance})`,
          name: 'amount',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // The token amount should be numeric
            if (!isNumber(input)) {
              return 'Expected numeric amount for sale';
            }

            if (input > balance) {
              return 'Sale amount cannot be more than available balance';
            }

            return true;
          },
        },
        (err, result) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorAskingForSaleAmount', {err}]);
          }

          return cbk(null, result);
        });
      }],

      // Ask for the rate
      askForRate: ['askForAmount', ({}, cbk) => {
        return ask({
          default: '1',
          message: 'Price of channel in fiat or ppm? (Example: 25*USD or 2000)',
          name: 'rate',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // Price of sale should be in fiat or numeric ppm
            if (!hasFiat(input) && !isNumber(input)) {
              return 'Expected fiat or numeric ppm fee rate for sale';
            }

            return true;
          },
        },
        (err, result) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorAskingForRate', err]);
          }

          return cbk(null, result);
        });
      }],

      // Ask for the expiration of the channel sale
      askForExpiration: ['askForRate', ({askForRate}, cbk) => {
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

      // Calculate sale cost
      saleCost: [
        'askForAmount',
        'askForExpiration',
        'askForRate',
        async ({askForRate, askForAmount}) =>
      { 
        // Exit early when no fiat is referenced
        if (!hasFiat(askForRate.rate)) {
          return saleCost(askForAmount.amount, askForRate.rate);
        }

        // Get fiat conversion rate to use for sale
        const cost = await convertFiatToBtc({request, fiat_price: askForRate.rate});

        return cost;
      }],

      // Description of sale
      description: [
        'askForAmount',
        'getIdentity',
        ({askForAmount, getIdentity}, cbk) =>
      {
        const alias = getIdentity.alias || getIdentity.public_key;

        return cbk(null, tradeDescription(alias, askForAmount.amount));
      }],

      // Create an anchor invoice for the channel sale
      createAnchor: [
        'askForExpiration',
        'askForRate',
        'description',
        'saleCost',
        ({
          askForExpiration, 
          description, 
          saleCost
        }, 
        cbk) =>
      {
        return createAnchoredTrade({
          description,
          lnd,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          secret: saleSecret,
          tokens: asNumber(saleCost),
        },
        cbk);
      }],

      // Wait for a peer to connect and ask for the channel sale details
      serviceSaleRequests: [
        'askForAmount',
        'askForExpiration',
        'askForRate',
        'createAnchor',
        'description',
        'getChannels',
        'getNetwork',
        'getIdentity',
        ({
          askForAmount,
          askForExpiration,
          askForRate,
          createAnchor,
          description,
          getChannels,
          getNetwork,
          getIdentity,
          saleCost,
        },
        cbk) =>
      {
        const tokens = !!hasFiat(askForRate.rate) ? askForRate.rate : asNumber(saleCost);

        return serviceOpenTrade({
          action,
          description,
          lnd,
          logger,
          request,
          tokens,
          capacity: askForAmount.amount,
          channels: getChannels.channels,
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          id: createAnchor.id,
          network: getNetwork.network,
          public_key: getIdentity.public_key,
          secret: saleSecret,
          uris: (getIdentity.uris || []),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
