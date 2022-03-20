const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {createHodlInvoice} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getInvoice} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const convertFiat = require('./convert_fiat');
const decodeAnchoredTrade = require('./decode_anchored_trade');
const encodeTradePayment = require('./encode_trade_payment');
const encodeTradeSecret = require('./encode_trade_secret');
const encryptTradeSecret = require('./encrypt_trade_secret');

const asNumber = n => parseFloat(n, 10);
const bufferAsHex = buffer => buffer.toString('hex');
const {ceil} = Math;
const defaultShortInvoiceExpiryMs = 1000 * 60 * 30;
const estimatedChannelOpenSizeVbytes = 250;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const makePaymentSecret = () => randomBytes(32).toString('hex');
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const slowConf = 144;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Create a trade secret for a node

  {
    [channel]: <Sell Channel With Capacity Tokens Number>
    [description]: <Trade Description String>
    expires_at: <Trade Expires At ISO 8601 Date String>
    [id]: <Trade Anchor Id Hex String>
    is_hold: <Create Hold Invoice Bool>
    lnd: <Authenticated LND API Object>
    [price]: <Trade Price String>
    [request]: <Request Function>
    [secret]: <Secret Payload String>
    to: <To Public Key Hex Encoded String>
    [tokens]: <Price Tokens Number or Fiat>
  }

  @returns via cbk or Promise
  {
    id: <Payment Hash Hex String>
    [secret]: <Hex Encoded Payment Secret String>
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.channel && !args.description) {
          return cbk([400, 'ExpectedDescriptionToFinalizeTrade']);
        }

        if (!!args.channel && !args.is_hold) {
          return cbk([400, 'ExpectedChannelAsHoldInvoiceToFinalizeTrade']);
        }

        if (!args.expires_at) {
          return cbk([400, 'ExpectedExpiresAtDateToFinalizeTrade']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToFinalizeTrade']);
        }

        if (!args.price && !args.tokens) {
          return cbk([400, 'ExpectedTokensPriceToFinalizeTrade']);
        }

        if (!!args.price && !args.request) {
          return cbk([400, 'ExpectedRequestFunctionToFinalizeTrade']);
        }

        if (!args.channel && !args.secret) {
          return cbk([400, 'ExpectedChannelOrSecretValueToFinalizeTrade']);
        }

        if (!args.to) {
          return cbk([400, 'ExpectedToPublicKeyToFinalizeTrade']);
        }

        return cbk();
      },

      // Description for the final invoice
      description: ['validate', ({}, cbk) => {
        if (!args.channel) {
          return cbk(null, args.description);
        }

        // Make a description for a channel creation
        const capacity = tokensAsBigUnit(args.channel);
        const node = args.to;

        const description = `Attempt ${capacity} channel creation to ${node}`;

        return cbk(null, description);
      }],

      // Encrypt the secret data
      encrypt: ['validate', ({}, cbk) => {
        // Exit early when there is no trade of a secret
        if (!args.secret) {
          return cbk(null, {payment_secret: makePaymentSecret()});
        }

        return encryptTradeSecret({
          lnd: args.lnd,
          secret: utf8AsHex(args.secret),
          to: args.to,
        },
        cbk);
      }],

      // Expiration for the final invoice
      expiry: ['validate', ({}, cbk) => {
        // Exit early when there is no price expression
        if (!args.price) {
          return cbk(null, args.expires_at);
        }

        // Price expressions get nearer term expiration dates
        const shortDate = futureDate(defaultShortInvoiceExpiryMs);

        // Check to make sure the short date doesn't go past the expiry
        if (shortDate > args.expires_at) {
          return cbk([410, 'TradeIsExpired']);
        }

        return cbk(null, shortDate);
      }],

      // Get the current chain fee rate to add a charge for channel sales
      getFeeRate: ['validate', ({}, cbk) => {
        // Exit early when this is not a channel sale
        if (!args.channel) {
          return cbk();
        }

        return getChainFeeRate({
          confirmation_target: slowConf,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get the sale price in tokens
      getTokens: ['validate', ({}, cbk) => {
        // Exit early when there is no price expression
        if (!args.price) {
          return cbk(null, {cost: args.tokens});
        }

        // Convert the price expression into a tokens cost
        return convertFiat({price: args.price, request: args.request}, cbk);
      }], 

      // Calculate the final sale price
      tokens: ['getFeeRate', 'getTokens', ({getFeeRate, getTokens}, cbk) => {
        // Exit early when there is no need to add chain fee for channel sales
        if (!args.channel) {
          return cbk(null, getTokens.cost);
        }

        // Create a surcharge for the vbytes cost of a channel open
        const vbytes = estimatedChannelOpenSizeVbytes;

        const chainFeeCharge = ceil(getFeeRate.tokens_per_vbyte * vbytes);

        return cbk(null, getTokens.cost + chainFeeCharge);
      }],

      // Create the final purchasing invoice
      createInvoice: [
        'description',
        'encrypt',
        'expiry',
        'tokens',
        ({description, encrypt, expiry, tokens}, cbk) =>
      {
        // Exit early when this is a hold invoice
        if (!!args.is_hold) {
          return createHodlInvoice({
            description,
            tokens,
            expires_at: expiry,
            id: bufferAsHex(sha256(hexAsBuffer(encrypt.payment_secret))),
            lnd: args.lnd,
            secret: encrypt.payment_secret,
          },
          cbk);
        }

        return createInvoice({
          description,
          tokens,
          expires_at: args.expires_at,
          lnd: args.lnd,
          secret: encrypt.payment_secret,
        },
        cbk);
      }],

      // Encode all the trade data into wire format
      encode: ['createInvoice', 'encrypt', ({createInvoice, encrypt}, cbk) => {
        // Exit early when this is a channel trade, there is no secret
        if (!!args.channel) {
          return cbk(null, {
            id: createInvoice.id,
            secret: encrypt.payment_secret,
            trade: encodeTradePayment({request: createInvoice.request}).trade,
          });
        }

        try {
          // Encode the trade secret records
          const {trade} = encodeTradeSecret({
            auth: encrypt.trade_auth_tag,
            payload: encrypt.trade_cipher,
            request: createInvoice.request,
          });

          return cbk(null, {
            trade,
            id: createInvoice.id,
            secret: encrypt.payment_secret,
          });
        } catch (err) {
          return cbk([500, err.message]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'encode'}, cbk));
  });
};
