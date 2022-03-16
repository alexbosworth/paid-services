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
    [logger]: <Winston Logger Object>
    secret: <Invoice to Settle Preimage Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.cancel)) {
          return cbk([400, 'ExpectedArrayOfIdsToCancelToAcceptTrade']);
        }

        if (!args.id) {
          return cbk([400, 'ExpectedAnchorTradeIdToAcceptTrade']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAcceptTrade']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedSettlementPreimageToAcceptTrade']);
        }

        return cbk();
      },

      // Fetch the anchor invoice to make sure it's still open
      getAnchor: ['validate', ({}, cbk) => {
        return getInvoice({id: args.id, lnd: args.lnd}, cbk);
      }],

      // Cancel alternative invoices so that only one resolves as settled
      cancel: ['getAnchor', ({}, cbk) => {
        return asyncEach([].concat(args.cancel).concat(args.id), (id, cbk) => {
          return cancelHodlInvoice({id, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Settle the held invoice with the preimage
      settle: ['cancel', ({}, cbk) => {
        return settleHodlInvoice({lnd: args.lnd, secret: args.secret}, cbk);
      }],

      // Open the channel
      openChannel: ['settle', ({}, cbk) => {
        // Exit early when the channel action is not a sell action
        if (args.action !== sellAction) {
          return cbk();
        }

        return openChannel({
          id: args.partner_public_key,
          lnd: args.lnd,
          tokens: args.capacity,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!!args.logger) {
            args.logger.info({channel_opened: res});
          }

          return cbk();
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
