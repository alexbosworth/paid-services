const asyncAuto = require('async/auto');
const {getChainBalance} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getWalletInfo} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const convertFiat = require('./convert_fiat');
const createAnchoredTrade = require('./create_anchored_trade');
const serviceOpenTrade = require('./service_open_trade');

const asNumber = n => parseFloat(n, 10);
const daysAsMs = days => Number(days) * 1000 * 60 * 60 * 24;
const defaultChannelSize = 5000000;
const defaultExpirationDays = 1;
const {floor} = Math;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const isNumber = n => !isNaN(n);
const {min} = Math;
const minChannelSize = 20000;
const ppmCost = (amount, rate) => Math.ceil(amount * rate / 1000000);
const priceFiat = 'price-in-fiat';
const pricePpm = 'price-in-ppm';
const priceTokens = 'price-in-tokens';
const query = 'How much would you like to sell?';
const usdAsPrice = usd => `${usd}*USD`;

/** Create a new channel sale

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateChannelSale']);
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

      // Get the current chain balance to set the limit for a channel sale
      getBalance: ['validate', ({}, cbk) => getChainBalance({lnd}, cbk)],

      // Get the public channels to use for an open trade
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd, is_public: true}, cbk);
      }],

      // Get self identity, including alias
      getIdentity: ['validate', ({}, cbk) => getWalletInfo({lnd}, cbk)],

      // Get the network name to use for an open trade
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Ask for channel capacity to sell
      askForAmount: ['getBalance', ({getBalance}, cbk) => {
        if (getBalance.chain_balance < minChannelSize) {
          return cbk([400, 'InsufficientOnChainFundsToSellChannel']);
        }

        return ask({
          default: min(defaultChannelSize, getBalance.chain_balance),
          message: `${query} (Available balance: ${getBalance.chain_balance})`,
          name: 'amount',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // The token amount should be numeric
            if (!isNumber(input)) {
              return 'Expected numeric amount for channel capacity';
            }

            // Avoid listing more coins than are present on-chain
            if (Number(input) > getBalance.chain_balance) {
              return 'Capacity cannot be more than available balance';
            }

            if (Number(input) < minChannelSize) {
              return `Channel capacity must be larger than ${minChannelSize}`;
            }

            // Disallow fractional values
            if (!!isNumber(input) && floor(input) !== asNumber(input)) {
              return 'Decimal capacities are not supported';
            }

            return true;
          },
        },
        cbk);
      }],

      // Select method of pricing
      selectPricing: ['askForAmount', ({}, cbk) => {
        return ask({
          choices: [
            {name: 'Set absolute price', value: priceTokens},
            {name: 'Set price by PPM (parts per million)', value: pricePpm},
            {name: 'Set price in fiat (USD)', value: priceFiat},
          ],
          default: pricePpm,
          message: '?',
          name: 'action',
          type: 'list',
        },
        cbk);
      }],

      // Ask for fiat based cost
      askForFiat: ['selectPricing', ({selectPricing}, cbk) => {
        // Exit early when the pricing is not in fiat
        if (selectPricing.action !== priceFiat) {
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

      // Ask for absolute cost
      askForPrice: ['selectPricing', ({selectPricing}, cbk) => {
        // Exit early when the pricing is not absolute
        if (selectPricing.action !== priceTokens) {
          return cbk();
        }

        return ask({
          default: '1337',
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

      // Ask for rate-based cost
      askForRate: ['askForAmount', 'selectPricing', ({selectPricing}, cbk) => {
        // Exit early when the pricing is not in ppm
        if (selectPricing.action !== pricePpm) {
          return cbk();
        }

        return ask({
          default: '350',
          message: 'Price in PPM?',
          name: 'rate',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // Price of sale should be in numeric ppm
            if (!isNumber(input)) {
              return 'Unable to parse rate, try a numeric ppm rate?';
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

      // Ask for the expiration of the channel sale
      askForDays: ['askForFiat', 'askForPrice', 'askForRate', ({}, cbk) => {
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

      // Check ability to get fiat prices
      checkCostLookup: ['askForFiat', ({askForFiat}, cbk) => {
        // Exit early when no fiat is referenced
        if (!askForFiat) {
          return cbk();
        }

        return convertFiat({request, price: usdAsPrice(askForFiat.usd)}, cbk);
      }],

      // Determine the tokens value of the trade
      cost: [
        'askForAmount',
        'askForFiat',
        'askForPrice',
        'askForRate',
        ({askForAmount, askForFiat, askForPrice, askForRate}, cbk) =>
      {
        // Exit early when price is in fiat, not tokens
        if (!!askForFiat) {
          return cbk(null, {price: usdAsPrice(askForFiat.usd)});
        }

        // Exit early when the price is specified directly
        if (!!askForPrice) {
          return cbk(null, {tokens: askForPrice.tokens});
        }

        // Calculate the rate that was specified in PPM
        const tokens = ppmCost(Number(askForAmount.amount), askForRate.rate);

        return cbk(null, {tokens});
      }],

      // Create an anchor invoice for the channel sale
      createAnchor: [
        'askForAmount',
        'askForDays',
        'checkCostLookup',
        'cost',
        ({askForAmount, askForDays, askForRate, cost}, cbk) =>
      {
        return createAnchoredTrade({
          lnd,
          channel: Number(askForAmount.amount),
          expires_at: futureDate(daysAsMs(askForDays.days)),
          price: cost.price,
          tokens: cost.tokens,
        },
        cbk);
      }],

      // Wait for a peer to connect and ask for the channel sale details
      serviceSaleRequests: [
        'askForAmount',
        'askForDays',
        'cost',
        'createAnchor',
        'getChannels',
        'getNetwork',
        'getIdentity',
        ({
          askForAmount,
          askForDays,
          askForRate,
          cost,
          createAnchor,
          getChannels,
          getNetwork,
          getIdentity,
        },
        cbk) =>
      {
        return serviceOpenTrade({
          lnd,
          logger,
          request,
          channel: Number(askForAmount.amount),
          channels: getChannels.channels,
          expires_at: futureDate(daysAsMs(askForDays.days)),
          id: createAnchor.id,
          network: getNetwork.network,
          price: cost.price,
          public_key: getIdentity.public_key,
          tokens: cost.tokens,
          uris: (getIdentity.uris || []),
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
