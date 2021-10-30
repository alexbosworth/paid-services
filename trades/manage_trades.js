const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const createTrade = require('./create_trade');
const manageTrade = require('./manage_trade');

const createAction = 'create';
const decodeAction = 'decode';

/** Create, view, and accept trades

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
  }

  @returns via cbk or Promise
*/
module.exports = ({ask, lnd, logger}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToManageTrades']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageTrades']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToManageTrades']);
        }

        return cbk();
      },

      // Select a trade option
      select: ['validate', ({}, cbk) => {
        return ask({
          choices: [
            {name: 'Create Trade', value: createAction},
            {name: 'Decode Trade', value: decodeAction},
          ],
          message: 'Trade?',
          name: 'action',
          type: 'list',
        },
        cbk);
      }],

      // Create a new trade
      create: ['select', ({select}, cbk) => {
        // Exit early when not creating a new trade
        if (select.action !== createAction) {
          return cbk();
        }

        return createTrade({ask, lnd, logger}, cbk);
      }],

      // Trade was created
      created: ['create', ({create}, cbk) => {
        // Exit early when not creating a new trade
        if (!create) {
          return cbk();
        }

        logger.info({encoded_trade_created: create.trade});

        return cbk();
      }],

      // View an existing trade
      view: ['select', ({select}, cbk) => {
        // Exit early when not decoding a trade
        if (select.action !== decodeAction) {
          return cbk();
        }

        return manageTrade({ask, lnd, logger}, cbk)
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
