const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const asyncRetry = require('async/retry');
const {cancelHodlInvoice} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getInvoice} = require('ln-service');
const {getPayment} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const buyPreimage = require('./buy_preimage');
const decodeTrade = require('./decode_trade');
const decryptTradeSecret = require('./decrypt_trade_secret');
const findTrade = require('./find_trade');

const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString();
const {isArray} = Array;
const isHexPreimage = n => !!n && /^[0-9A-F]{64}$/i.test(n);
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Manage an individual trade

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
          return cbk([400, 'ExpectedAskFunctionToManageTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToManageTrade']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToManageTrade']);
        }

        return cbk();
      },

      // Get the trade data to decode it
      askForTrade: ['validate', ({}, cbk) => {
        return ask({
          name: 'trade',
          message: 'Enter encoded trade',
          type: 'input',
          validate: input => !!input,
        },
        cbk);
      }],

      // Derive the self public key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Decode the trade data
      decodeDetails: ['askForTrade', ({askForTrade}, cbk) => {
        try {
          const details = decodeTrade({trade: askForTrade.trade});

          return cbk(null, details);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Get details about an open ended trade
      findTrade: [
        'decodeDetails',
        'getIdentity',
        ({decodeDetails, getIdentity}, cbk) =>
      {
        // Exit early when there is a known trade
        if (!!decodeDetails.secret) {
          return cbk(null, {
            auth: decodeDetails.secret.auth,
            payload: decodeDetails.secret.payload,
            request: decodeDetails.secret.request,
          });
        }

        // Get the trade details interactively
        return findTrade({
          ask,
          lnd,
          logger,
          id: decodeDetails.connect.id,
          identity: getIdentity.public_key,
          nodes: decodeDetails.connect.nodes,
        },
        cbk);
      }],

      // Parse the trade payment request
      requestDetails: ['findTrade', ({findTrade}, cbk) => {
        try {
          return cbk(null, parsePaymentRequest({request: findTrade.request}));
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Get the invoice for the trade in case its our own trade
      getRequest: ['requestDetails', asyncReflect(({requestDetails}, cbk) => {
        return getInvoice({lnd, id: requestDetails.id}, cbk);
      })],

      // Get payment paid for the trade
      getPurchase: ['requestDetails', asyncReflect(({requestDetails}, cbk) => {
        return getPayment({lnd, id: requestDetails.id}, cbk);
      })],

      // Show resolved offer details
      resolvedOffer: [
        'getIdentity',
        'getRequest',
        'requestDetails',
        ({getIdentity, getRequest, requestDetails}, cbk) =>
      {
        // Exit early when this is not an own offer
        if (requestDetails.destination !== getIdentity.public_key) {
          return cbk();
        }

        // A missing invoice may signal that it is removed
        const invoice = getRequest.value || {is_canceled: true};

        // Exit early when request is still live
        if (!invoice.is_canceled && !invoice.is_confirmed) {
          return cbk();
        }

        logger.info({
          id: requestDetails.id,
          offering: requestDetails.description,
          price: tokensAsBigUnit(requestDetails.tokens),
          is_canceled: invoice.is_canceled || undefined,
          is_purchased: invoice.is_confirmed || undefined,
        });

        return cbk();
      }],

      // Select an offer action for the trade
      selectOfferAction: [
        'getRequest',
        'getPurchase',
        'requestDetails',
        ({getRequest, requestDetails}, cbk) =>
      {
        // Exit early when this is not our own offer
        if (!getRequest.value) {
          return cbk();
        }

        // Exit early when the payment was made
        if (getRequest.value.is_confirmed) {
          return cbk();
        }

        logger.info({
          id: requestDetails.id,
          offering: requestDetails.description,
          price: tokensAsBigUnit(requestDetails.tokens),
        });

        return ask({
          choices: [
            {name: 'Exit', value: 'exit'},
            {name: 'Cancel offer', value: 'cancel'},
          ],
          message: ' ',
          name: 'action',
          type: 'list',
        },
        cbk);
      }],

      // Cancel past offer
      cancelOffer: [
        'requestDetails',
        'selectOfferAction',
        ({requestDetails, selectOfferAction}, cbk) =>
      {
        // Exit early when there is no action to take
        if (!selectOfferAction || selectOfferAction.action !== 'cancel') {
          return cbk();
        }

        return cancelHodlInvoice({lnd, id: requestDetails.id}, err => {
          if (!!err) {
            return cbk(err);
          }

          logger.info({trade_canceled: true});

          return cbk();
        });
      }],

      // Select a purchase option for the trade
      selectPurchaseAction: [
        'findTrade',
        'getPurchase',
        'getRequest',
        'requestDetails',
        ({findTrade, getPurchase, getRequest, requestDetails}, cbk) =>
      {
        // Exit early when the trade was already purchased
        if (!!getPurchase.value && !!getPurchase.value.is_confirmed) {
          return cbk();
        }

        // Exit early when this is a known outgoing trade
        if (!!getRequest.value) {
          return cbk();
        }

        logger.info({trade: findTrade.trade});

        logger.info({
          request: findTrade.request,
          purchase: requestDetails.description,
          price: tokensAsBigUnit(requestDetails.tokens),
          to: requestDetails.destination,
        });

        // Select an action to take on the decoded trade
        return ask({
          choices: [
            {name: 'Purchase', value: 'buy'},
            {name: 'Already purchased?', value: 'reveal'},
          ],
          message: ' ',
          name: 'action',
          type: 'list',
        },
        cbk);
      }],

      // Ask for preimage in case it is separately known
      askForPreimage: [
        'requestDetails',
        'selectPurchaseAction',
        ({requestDetails, selectPurchaseAction}, cbk) =>
      {
        // Exit early when this is not a purchase
        if (!selectPurchaseAction) {
          return cbk();
        }

        // Exit early when preimage entry is not selected
        if (selectPurchaseAction.action !== 'reveal') {
          return cbk();
        }

        return ask({
          message: `Enter the preimage for payment ${requestDetails.id}`,
          name: 'secret',
          type: 'input',
          validate: input => {
            if (!input) {
              return false;
            }

            if (!isHexPreimage(input)) {
              return 'Enter the secret preimage in hex encoded format';
            }

            return true;
          },
        },
        cbk);
      }],

      // Pay and get the preimage through paying for it
      payForPreimage: [
        'findTrade',
        'selectPurchaseAction',
        ({findTrade, selectPurchaseAction}, cbk) =>
      {
        // Exit early when this is an offer
        if (!selectPurchaseAction) {
          return cbk();
        }

        // Exit early when buy is not selected
        if (selectPurchaseAction.action !== 'buy') {
          return cbk();
        }

        const {request} = findTrade;

        return asyncRetry({
          errorFilter: err => !!isArray(err) && err.slice().shift() >= 500,
        },
        cbk => buyPreimage({ask, lnd, logger, request}, cbk), cbk);
      }],

      // Use the preimage to decrypt the trade secret
      decryptSecret: [
        'askForPreimage',
        'findTrade',
        'getPurchase',
        'payForPreimage',
        'requestDetails',
        'selectPurchaseAction',
        ({
          askForPreimage,
          findTrade,
          getPurchase,
          payForPreimage,
          requestDetails,
          selectPurchaseAction,
        },
        cbk) =>
      {
        // Exit early when this is not a purchase
        if (!payForPreimage && !askForPreimage && !getPurchase.value) {
          return cbk();
        }

        // Exit early when there is no successful purchase
        if (!!getPurchase.value && !getPurchase.value.payment) {
          return cbk();
        }

        // Notify when a preimage was paid for
        if (!!payForPreimage) {
          logger.info({
            paid: payForPreimage.tokens,
            fee: payForPreimage.fee,
            secret: payForPreimage.secret,
          });
        }

        const {payment} = getPurchase.value || {};

        const paid = payForPreimage || askForPreimage || payment;

        const {auth, payload} = findTrade;

        return decryptTradeSecret({
          auth,
          lnd,
          payload,
          from: requestDetails.destination,
          secret: paid.secret,
        },
        cbk);
      }],

      // Log the trade details
      trade: [
        'decryptSecret',
        'selectPurchaseAction',
        ({decryptSecret, selectPurchaseAction}, cbk) =>
      {
        // Exit early when not purchasing
        if (!decryptSecret) {
          return cbk();
        }

        logger.info({trade_complete: hexAsUtf8(decryptSecret.plain)});

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
