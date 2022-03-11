const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {createHodlInvoice} = require('ln-service');
const {createInvoice} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const encodeTradeSecret = require('./encode_trade_secret');
const encryptTradeSecret = require('./encrypt_trade_secret');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const openSizeVbytes = 250; 
const sha256 = preimage => createHash('sha256').update(preimage).digest();
const sellAction = 'sell';
const slowConf = 144;
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Create a trade secret for a node

  {
    action: <Ask function action>
    description: <Trade Description String>
    expires_at: <Trade Expires At ISO 8601 Date String>
    is_hold: <Create Hold Invoice Bool>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    secret: <Clear Secret String>
    to: <To Public Key Hex Encoded String>
    tokens: <Price Tokens Number>
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

      // Get low fee rate
      calculateSalePrice: ['validate', ({}, cbk) => {
        if (args.action !== sellAction) {
          return cbk(null, {});
        }
        getChainFeeRate({
          confirmation_target: slowConf,
          lnd: args.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const totalSaleCost = (res.tokens_per_vbyte * openSizeVbytes) + args.tokens;

          args.logger.info({total_channel_sale_cost: totalSaleCost});

          return cbk(null, {totalSaleCost});
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
      createInvoice: ['encrypt', 'calculateSalePrice', ({encrypt, calculateSalePrice}, cbk) => {
        // Exit early when this is a hold invoice
        if (!!args.is_hold) {
          return createHodlInvoice({
            description: args.description,
            expires_at: args.expires_at,
            id: bufferAsHex(sha256(hexAsBuffer(encrypt.payment_secret))),
            lnd: args.lnd,
            secret: encrypt.payment_secret,
            tokens: calculateSalePrice.totalSaleCost || args.tokens,
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
