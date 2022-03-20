const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const encodeAnchoredTrade = require('./encode_anchored_trade');

const maxDescLength = 100;
const maxSecretLength = 100;

/** Create an anchored trade

  Either a channel or description and secret is required

  Either a price or tokens is required

  {
    [channel]: <Channel Sale Capacity Tokens Number>
    [description]: <Trade Description String>
    expires_at: <Trade Expires at ISO 8601 Date String>
    lnd: <Authenticated LND API Object>
    [price]: <Trade Price String>
    [secret]: <Trade Secret String>
    [tokens]: <Trade Price Tokens Number>
  }

  @returns via cbk or Promise
  {
    id: <Anchored Trade Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.channel && !args.description) {
          return cbk([400, 'ExpectedTradeDescriptionToCreateAnchoredTrade']);
        }

        if (!args.channel && !args.secret) {
          return cbk([400, 'ExpectedEitherChannelOrSecretToTrade']);
        }

        if (!!args.description && args.description.length > maxDescLength) {
          return cbk([400, 'ExpectedShorterTradeDescriptionToCreateTrade']);
        }

        if (!args.expires_at) {
          return cbk([400, 'ExpectedTradeExpirationDateToCreateTrade']);
        }

        if (args.expires_at < new Date().toISOString()) {
          return cbk([400, 'ExpectedLaterExpiresAtDateToCreateTrade']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToCreateAnchoredTrade']);
        }

        if (!args.price && !args.tokens) {
          return cbk([400, 'ExpectedTokensPriceToCreateAnchoredTrade']);
        }

        if (!!args.secret && args.secret.length > maxSecretLength) {
          return cbk([400, 'ExpectedShorterTradeSecretToCreateAnchoredTrade']);
        }

        return cbk();
      },

      // Create the trade
      create: ['validate', ({}, cbk) => {
        const {encoded} = encodeAnchoredTrade({
          channel: args.channel,
          description: args.description,
          price: args.price,
          secret: args.secret,
        });

        // The anchor invoice description will contain the trade details
        return createInvoice({
          description: encoded,
          expires_at: args.expires_at,
          lnd: args.lnd,
          tokens: args.tokens,
        },
        cbk);
      }],

      // Final trade
      trade: ['create', ({create}, cbk) => cbk(null, {id: create.id})],
    },
    returnResult({reject, resolve, of: 'trade'}, cbk));
  });
};
