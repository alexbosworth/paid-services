const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {returnResult} = require('asyncjs-util');
const {getNetwork} = require('ln-sync');
const {getChainFeeRate} = require('ln-service');
const {getChannels} = require('ln-service');
const {getWalletInfo} = require('ln-service');
const {randomBytes} = require('crypto');
const createAnchoredTrade = require('./create_anchored_trade');
const serviceOpenTrade = require('./service_open_trade');

// const serviceChannelSale = require('../sales/service_channel_sale');

const asNumber = n => parseFloat(n, 10);
const defaultExpirationDays = 1;
const daysAsMs = days => Number(days) * 1000 * 60 * 60 * 24;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const isNumber = n => !isNaN(n);
const slowTarget = 1000;
const saleCost = (amount, rate) => (amount * rate / 1000000).toFixed(0);
const saleSecret = randomBytes(48).toString('hex');
const sellAction = 'sell';
const tradeDescription = (alias, capacity) => `channel-sale:${alias}--${capacity}`;



module.exports = ({action, balance, ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!action) {
          return cbk([400, 'ExpectedActionTypeToCreateChannelSale']);
        }

        if (balance === undefined) {
          return cbk([400, 'ExpectedOnChainBalanceToCreateChannelSale']);
        }

        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToCreateChannelSale']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToCreateChannelSale']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToCreateChannelSale']);
        }

        return cbk();
      },

      //Get Identiy
      getIdentity: ['validate', ({}, cbk) => {
        return getWalletInfo({lnd}, cbk);
      }],

      // Get the public channels to use for an open trade
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd, is_public: true}, cbk);
      }],

      // Get the network name to use for an open trade
      getNetwork: ['validate', ({}, cbk) => {
        return getNetwork({lnd}, cbk);
      }],

      // Ask for sale amount 
      askForAmount: ['validate', ({}, cbk) => {
        return ask({
          message: `How much would you like to sell? (Available balance: ${balance})`,
          name: 'amount',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // The connect code should be entirely numeric, not an API key
            if (!isNumber(input)) {
              return `Expected numeric amount for sale`;
            }

            if (input > balance) {
              return `Sale amount must be less than available balance`;
            }

            return true;
          },
        },
        (err, result) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorAskingForSaleAmount', err]);
          }

          return cbk(null, result);
        });
      }],

      // Ask for rate
      askForRate: ['validate', 'askForAmount', ({}, cbk) => {
        return ask({
          message: 'Rate to charge in ppm?',
          name: 'rate',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            // The connect code should be entirely numeric, not an API key
            if (!isNumber(input)) {
              return `Expected numeric fee rate for sale`;
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

      // Calculate sale cost
      saleCost: ['askForAmount', 'askForRate', ({askForRate, askForAmount}, cbk) => {
        const {amount} = askForAmount;
        const {rate} = askForRate;

        const cost = saleCost(amount, rate);

        return cbk(null, cost);
      }],

      // Ask for the expiration of the channel sale
      askForExpiration: ['askForRate', ({}, cbk) => {
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

      // Create an anchor invoice for the channel sale
      createAnchor: [
        'askForAmount',
        'askForExpiration',
        'askForRate',
        'getIdentity',
        'saleCost',
        ({
          askForAmount,
          askForExpiration,
          askForRate,
          getIdentity,
          saleCost,
        },
        cbk) =>
      {
        return createAnchoredTrade({
          lnd,
          description: tradeDescription(getIdentity.alias, askForAmount.amount),
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
        'createAnchor',
        'getChannels',
        'getNetwork',
        'getIdentity',
        ({
          askForAmount,
          askForExpiration,
          createAnchor,
          getChannels,
          getNetwork,
          getIdentity,
          saleCost,
        },
        cbk) =>
      {
        return serviceOpenTrade({
          action,
          lnd,
          logger,
          capacity: askForAmount.amount,
          channels: getChannels.channels,
          description: tradeDescription(getIdentity.alias, askForAmount.amount),
          expires_at: futureDate(daysAsMs(askForExpiration.days)),
          id: createAnchor.id,
          network: getNetwork.network,
          public_key: getIdentity.public_key,
          secret: saleSecret,
          tokens: asNumber(saleCost),
          uris: (getIdentity.uris || []),
        },
        cbk);
      }],

      // Encode channel sale
      result: [
        'askForAmount',
        'askForExpiration',
        'createAnchor',
        'getIdentity',
        'askForRate',
        'validate',
        ({}, cbk) => {
          return cbk();
        }],


    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
