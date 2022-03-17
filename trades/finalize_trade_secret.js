const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {createHodlInvoice} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getInvoice} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const convertFiatToBtc = require('./convert_fiat_to_btc');
const decodeAnchoredTrade = require('./decode_anchored_trade');
const encodeTradeSecret = require('./encode_trade_secret');
const encryptTradeSecret = require('./encrypt_trade_secret');

const asNumber = n => parseFloat(n, 10);
const bufferAsHex = buffer => buffer.toString('hex');
const {ceil} = Math;
const defaultFiatInvoiceExpiryMs = 30 * 60 * 1000;
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const hasFiat = n => /(aud|cad|eur|gbp|inr|jpy|usd)/gim.test(n);
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const openSizeVbytes = 250;
const sellAction = 'sell';
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const slowConf = 144;
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
const anchorPrefix = 'anchor-trade-secret:';
/** Create a trade secret for a node

  {
    action: <Trade Action String>
    description: <Trade Description String>
    expires_at: <Trade Expires At ISO 8601 Date String>
    [id]: <Trade Anchor Id Hex String>
    is_hold: <Create Hold Invoice Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
    secret: <Clear Secret String>
    to: <To Public Key Hex Encoded String>
    tokens: <Price Tokens Number or Fiat>
  }

  @returns via cbk or Promise
  {
    id: <Payment Hash Hex String>
    secret: <Hex Encoded Payment Secret String>
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.description) {
          return cbk([400, 'ExpectedDescriptionToFinalizeTradeSecret']);
        }

        if (!args.expires_at) {
          return cbk([400, 'ExpectedExpiresAtDateToFinalizeTradeSecret']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToFinalizeTradeSecret']);
        }

        if (!args.logger) {
          return cbk([400, 'ExpectedWinstonLoggerToFinalizeTradeSecret']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedRequestFunctionToFinalizeTradeSecret']);
        }

        if (!args.secret) {
          return cbk([400, 'ExpectedSecretValueToFinalizeTradeSecret']);
        }

        if (!args.to) {
          return cbk([400, 'ExpectedToPublicKeyToFinalizeTradeSecret']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensPriceToFinalizeTradeSecret']);
        }

        return cbk();
      },

      // Get the anchor invoice
      getAnchorInvoice: ['validate', ({}, cbk) => {
        // Exit early when there is no anchor invoice (closed trade)
        if (!args.id) {
          return cbk(null, {});
        }

        getInvoice({
          id: args.id,
          lnd: args.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk([503, 'UnexpectedErrorGettingAnchorInvoice', {err}]);
          }

          const {description} = res;

          return cbk(null, {description});
        },
        cbk);
      }],

      // Parse anchor invoice
      decodeAnchorInvoice: ['getAnchorInvoice', ({getAnchorInvoice}, cbk) => {
        // Exit early when there is no anchor invoice
        if (!getAnchorInvoice.description) {
          return cbk(null, {});
        }

        try {
          const {description} = getAnchorInvoice;

          const {trade} = decodeAnchoredTrade({encoded: description});
  
          return cbk(null, {trade});
        } catch (err) {
          return cbk([503, 'UnexpectedErrorDecodingAnchorInvoice', err]);
        }
      }],

      // Convert fiat to btc
      validateTokens: ['decodeAnchorInvoice', async ({decodeAnchorInvoice}) => {
        // Exit early when there is no anchor invoice
        if (!decodeAnchorInvoice.trade) {
          return {};
        }

        // Exit early if fiat is not used
        const {price} = decodeAnchorInvoice.trade;
        
        if (!price) {
          return {price: undefined, tokens: asNumber(args.tokens)};
        }

        const tokens = await convertFiatToBtc({fiat_price: price, request: args.request});

        args.logger.info({fiat_to_satoshis: tokens});

        return {price, tokens: asNumber(tokens)};
      }], 

      // Calculate dynamic sale price for channel sales
      salePrice: ['validateTokens', ({validateTokens}, cbk) => {
        // Exit early when this is not a channel sale
        if (args.action !== sellAction) {
          return cbk(null, {});
        }

        // Get a chain fee rate to dynamically price vs the chain cost
        return getChainFeeRate({
          confirmation_target: slowConf,
          lnd: args.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const chainSurcharge = ceil(res.tokens_per_vbyte * openSizeVbytes);

          const price = chainSurcharge + validateTokens.tokens;

          args.logger.info({total_channel_sale_cost: price});

          return cbk(null, {price});
        },
        cbk);
      }],

      // Encrypt the secret data
      encrypt: ['validate', ({}, cbk) => {
        return encryptTradeSecret({
          lnd: args.lnd,
          secret: utf8AsHex(args.secret),
          to: args.to,
        },
        cbk);
      }],

      // Create the invoice to purchase the unlocking secret
      createInvoice: [
        'encrypt', 
        'salePrice', 
        'validateTokens', 
        ({encrypt, salePrice, validateTokens}, cbk) => {
          // Exit early when this is a hold invoice
          if (!!args.is_hold) {
          const expiry = !!hasFiat(validateTokens.price) ? futureDate(defaultFiatInvoiceExpiryMs) : args.expires_at;

          return createHodlInvoice({
            description: args.description,
            expires_at: expiry,
            id: bufferAsHex(sha256(hexAsBuffer(encrypt.payment_secret))),
            lnd: args.lnd,
            secret: encrypt.payment_secret,
            tokens: salePrice.price || validateTokens.tokens,
          },
          cbk);
        }

        return createInvoice({
          description: args.description,
          expires_at: args.expires_at,
          lnd: args.lnd,
          secret: encrypt.payment_secret,
          tokens: args.tokens,
        },
        cbk);
      }],

      // Encode all the trade data into wire format
      encode: ['createInvoice', 'encrypt', ({createInvoice, encrypt}, cbk) => {
        try {
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
