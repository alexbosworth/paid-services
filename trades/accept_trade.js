const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {cancelHodlInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');

const {isArray} = Array;

/** Accept an open ended trade

  {
    cancel: [<Alternative Invoice Id Hex String>]
    lnd: <Authenticated LND API Object>
    secret: <Invoice to Settle Preimage Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = ({cancel, lnd, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(cancel)) {
          return cbk([400, 'ExpectedArrayOfIdsToCancelToAcceptTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAcceptTrade']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedSettlementPreimageToAcceptTrade']);
        }

        return cbk();
      },

      // Cancel alternative invoices so that only one resolves as settled
      cancel: ['validate', ({}, cbk) => {
        return asyncEach(cancel, (id, cbk) => {
          return cancelHodlInvoice({id, lnd}, cbk);
        },
        cbk);
      }],

      // Settle the held invoice with the preimage
      settle: ['cancel', ({}, cbk) => settleHodlInvoice({lnd, secret}, cbk)],
    },
    returnResult({reject, resolve}, cbk));
  });
};
