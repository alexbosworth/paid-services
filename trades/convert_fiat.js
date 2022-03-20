const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {getPrices} = require('@alexbosworth/fiat');
const {returnResult} = require('asyncjs-util');

const cached = {};
const convert = (price, rate) => Math.round((price * 1e8) / (rate / 100));
const defaultFiatRateProvider = 'coingecko';
const interval = 1000;
const isFresh = date => Date.now() - date > 1000 * 60 * 10;
let isLocked = false;
const isNumber = n => !isNaN(n);
const {now} = Date;
const parseFiat = n => n.split('*')[1];
const parseFiatPrice = n => Number(n.split('*')[0]);
const removeSpaces = s => s.replace(/\s/g, '');

/** Converts fiat to tokens

  A fiat price expression looks like AMOUNT*USD

  {
    price: <Fiat Price Expression String>
    request: <Request Function>
  }

  @returns
  {
    cost: <Price of Trade in Tokens>
  }
*/
module.exports = ({price, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!price) {
          return cbk([400, 'ExpectedFiatPriceToConvertFiat']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToConvertFiat']);
        }

        if (!isNumber(parseFiatPrice(price))) {
          return cbk([400, 'ExpectedFiatPriceNumberToConvert']);
        }

        return cbk();
      },

      // Wait for request lock to unlock
      waitForLock: ['validate', ({}, cbk) => {
        return asyncRetry({interval}, cbk => {
          if (isLocked) {
            return cbk([503, 'FailedToGetFiatRatesDueToBusyRateLookups']);
          }

          return cbk();
        },
        cbk);
      }],

      // Get the current exchange rate
      getRate: ['waitForLock', ({}, cbk) => {
        const fiat = parseFiat(removeSpaces(price));

        // Exit early when the rate has a fresh cache
        if (!!cached[fiat] && isFresh(cached[fiat].date)) {
          return cbk(null, cached[fiat].rate);
        }

        // Enable the request lock to avoid making simultaneous requests
        isLocked = true;

        return getPrices({
          request,
          from: defaultFiatRateProvider,
          symbols: [fiat],
        },
        (err, res) => {
          // Disable the request lock to allow another request through
          isLocked = false;

          if (!!err) {
            return cbk(err);
          }

          const [{rate}] = res.tickers;

          if (!rate) {
            return cbk([503, 'ExpectedFiatRateFromRateProvider']);
          }

          // Update the value cache to avoid hammering the service
          cached[fiat] = {rate, date: now()};

          // Return the fresh value
          return cbk(null, rate);
        });
      }],

      // Convert the price into a tokens cost
      cost: ['getRate', ({getRate}, cbk) => {
        const cost = convert(parseFiatPrice(price), getRate);

        return cbk(null, {cost});
      }],
    },
    returnResult({reject, resolve, of: 'cost'}, cbk));
  });
};
