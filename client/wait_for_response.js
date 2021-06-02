const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {subscribeToInvoice} = require('ln-service');

/** Wait for a paid service response

  {
    id: <Reply Invoice Id Hex String>
    lnd: <Authenticated LND API Object>
    ms: <Wait Up to Number of Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    payments: [{
      messages: [{
        type: <Message Type Number String>
        value: <Message Hex Value String>
      }]
    }]
  }
*/
module.exports = ({id, lnd, ms}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdToWaitForResponse']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToWaitForResponse']);
        }

        if (!ms) {
          return cbk([400, 'ExpectedMsTimeoutToWaitForResponse']);
        }

        return cbk();
      },

      // Wait for the invoice to come
      response: ['validate', ({}, cbk) => {
        const sub = subscribeToInvoice({lnd, id});

        const timeout = setTimeout(() => {
          sub.removeAllListeners();

          return cbk([503, 'TimedOutWaitingForResponse']);
        },
        ms);

        sub.on('error', err => {
          clearTimeout(timeout);

          return cbk([503, 'UnexpectedErrorWaitingForResponse', {err}]);
        });

        sub.on('invoice_updated', updated => {
          // Exit early when invoice is yet to be paid
          if (!updated.is_confirmed) {
            return;
          }

          clearTimeout(timeout);

          sub.removeAllListeners();

          return cbk(null, {payments: updated.payments});
        });
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
