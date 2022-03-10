const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {cancelHodlInvoice} = require('ln-service');
const {getInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');
const openChannel = require('./open_channel');
const {isArray} = Array;
const sellAction = 'sell';

/** Accept an open ended trade

  {
    cancel: [<Alternative Invoice Id Hex String>]
    id: <Trade Id Hex String>
    lnd: <Authenticated LND API Object>
    secret: <Invoice to Settle Preimage Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = ({action, cancel, capacity, id, lnd, logger, partner_public_key, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(cancel)) {
          return cbk([400, 'ExpectedArrayOfIdsToCancelToAcceptTrade']);
        }

        if (!id) {
          return cbk([400, 'ExpectedAnchorTradeIdToAcceptTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAcceptTrade']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerToAcceptTrade']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedSettlementPreimageToAcceptTrade']);
        }

        return cbk();
      },

      // Fetch the anchor invoice to make sure it's still open
      getAnchor: ['validate', ({}, cbk) => getInvoice({id, lnd}, cbk)],

      // Cancel alternative invoices so that only one resolves as settled
      cancel: ['getAnchor', ({}, cbk) => {
        return asyncEach([].concat(cancel).concat(id), (id, cbk) => {
          return cancelHodlInvoice({id, lnd}, cbk);
        },
        cbk);
      }],

      // Settle the held invoice with the preimage
      settle: ['cancel', ({}, cbk) => settleHodlInvoice({lnd, secret}, cbk)],

      // Open the channel
      openChannel: ['settle', ({}, cbk) => {
        if (action !== sellAction) {
          return cbk();
        }
          openChannel({
            lnd,
            id: partner_public_key,
            tokens: capacity,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }
            logger.info({channel_opened: res});
            return cbk();
          },
          cbk);
      }]
    },
    returnResult({reject, resolve}, cbk));
  });
};
