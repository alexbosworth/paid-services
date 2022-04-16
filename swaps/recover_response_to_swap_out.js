const EventEmitter = require('events');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const completeOnToOffSwap = require('./complete_on_to_off_swap');

/** Request a swap out

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
          return cbk([400, 'ExpectedAskFunctionToRecoverResponseToSwapOut']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRecoverResponseToSwap']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToRecoverResponseToSwapOut']);
        }

        if (!request) {
          return cbk([400, 'ExpectedRequestFunctionToRecoverResponseToSwap']);
        }

        return cbk();
      },

      // Ask for a recovery
      askForRecovery: ['validate', ({}, cbk) => {
        return ask({
          message: 'Swap response recovery?',
          name: 'recovery',
          validate: input => !!input,
        },
        ({recovery}) => cbk(null, recovery));
      }],

      // Complete the swap
      completeSwap: ['askForRecovery', ({askForRecovery}, cbk) => {
        const emitter = new EventEmitter();

        emitter.on('update', update => logger.info(update));

        return completeOnToOffSwap({
          emitter,
          lnd,
          request,
          recovery: askForRecovery,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'completeSwap'}, cbk));
  });
};
