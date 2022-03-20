const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {getInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const decodeAnchoredTrade = require('./decode_anchored_trade');

/** Get anchored trade

  {
    id: <Trade Id Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    [trade]: {
      [channel]: <Channel Sale Capacity Tokens Number>
      [description]: <Description of Trade String>
      expires_at: <Trade Expires at ISO 8601 Date String>
      [price]: <Trade Price String>
      [secret]: <Trade Secret String>
      [tokens]: <Trade Price Tokens Number>
    }
  }
*/
module.exports = ({id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedIdToGetAnchoredTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetAnchoredTrade']);
        }

        return cbk();
      },

      // Get invoice
      getInvoice: ['validate', asyncReflect(({}, cbk) => {
        return getInvoice({id, lnd}, cbk);
      })],

      // Decode trade details
      decode: ['getInvoice', ({getInvoice}, cbk) => {
        if (!getInvoice.value) {
          return cbk(null, {});
        }

        const encoded = getInvoice.value.description;

        const {trade} = decodeAnchoredTrade({encoded});

        if (!trade) {
          return cbk([400, 'ExpectedAnchoredTradeData']);
        }

        return cbk(null, {
          trade: {
            channel: trade.channel || undefined,
            description: trade.description || undefined,
            expires_at: getInvoice.value.expires_at,
            price: trade.price || undefined,
            secret: trade.secret || undefined,
            tokens: getInvoice.value.tokens || undefined,
          },
        });
      }],
    },
    returnResult({reject, resolve, of: 'decode'}, cbk));
  });
};
