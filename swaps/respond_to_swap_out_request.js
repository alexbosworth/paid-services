const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const {getChainFeeRate} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const completeOnToOffSwap = require('./complete_on_to_off_swap');
const decodeOffToOnRequest = require('./decode_off_to_on_request');
const startOnToOffSwap = require('./start_on_to_off_swap');

const {ceil} = Math;
const {floor} = Math;
const defaultCltvDelta = 400;
const defaultFeeRate = 5000;
const estimatedVirtualSize = 300;
const isNumber = n => !isNaN(n) && !isNaN(parseFloat(n));
const minRate = 1;
const rateDenominator = 1e6;

/** Respond to a swap out request

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    [request]: <Request Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToRespondToSwapOutRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRespondToSwapOutReq']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToRespondToSwapOutRequest']);
        }

        return cbk();
      },

      // Ask for a request
      askForRequest: ['validate', ({}, cbk) => {
        return ask({
          message: 'Swap request?',
          name: 'req',
          validate: input => {
            if (!input) {
              return;
            }

            try {
              decodeOffToOnRequest({request: input});
            } catch (err) {
              return 'Failed parse this request, check input?';
            }

            return true;
          },
        },
        ({req}) => cbk(null, req));
      }],

      // Get the chain fee rate
      getRate: ['validate', ({}, cbk) => getChainFeeRate({lnd}, cbk)],

      // Ask for pricing
      askForRate: ['askForRequest', ({askForRequest}, cbk) => {
        const {tokens} = decodeOffToOnRequest({request: askForRequest});

        logger.info({swap_amount: tokens});

        return ask({
          default: defaultFeeRate,
          message: 'Price fee rate for swap in parts per million?',
          name: 'rate',
          validate: input => {
            if (!isNumber(input)) {
              return false;
            }

            if (Number(input) < minRate) {
              return `A larger rate is required, minimum: ${minRate}`;
            }

            return true;
          },
        },
        ({rate}) => cbk(null, Number(rate)));
      }],

      // Make a response
      makeResponse: [
        'askForRate',
        'askForRequest',
        'getRate',
        ({askForRate, askForRequest, getRate}, cbk) =>
      {
        const {tokens} = decodeOffToOnRequest({request: askForRequest});

        return startOnToOffSwap({
          lnd,
          delta: defaultCltvDelta,
          deposit: ceil(getRate.tokens_per_vbyte * estimatedVirtualSize),
          is_external_solo_key: !!request,
          price: floor(tokens * askForRate / rateDenominator),
          request: askForRequest,
        },
        cbk);
      }],

      // Complete the swap
      completeSwap: ['makeResponse', ({makeResponse}, cbk) => {
        logger.info({
          recovery: makeResponse.recovery,
          response: makeResponse.response,
        });

        const emitter = new EventEmitter();

        emitter.on('update', update => logger.info(update));

        return completeOnToOffSwap({
          emitter,
          lnd,
          request,
          recovery: makeResponse.recovery,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'completeSwap'}, cbk));
  });
};
