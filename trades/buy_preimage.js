const asyncAuto = require('async/auto');
const {parsePaymentRequest} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {subscribeToProbeForRoute} = require('ln-service');

const cltvDeltaBuffer = 5;

/** Buy the preimage for a trade

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <BOLT 11 Encoded Payment Request String>
  }

  @returns via cbk or Promise
  {
    fee: <Fee Paid Number>
    secret: <Payment Preimage Hex String>
    tokens: <Tokens Paid Number>
  }
*/
module.exports = ({ask, lnd, logger, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToBuyTradePreimage']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToBuyTradePreimage']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToBuyTradePreimage']);
        }

        if (!request) {
          return cbk([400, 'ExpectedPaymentRequestToPurchaseTradePreimage']);
        }

        return cbk();
      },

      // Decode the payment request
      parseRequest: ['validate', ({}, cbk) => {
        try {
          const details = parsePaymentRequest({request});

          return cbk(null, {
            cltv_delta: details.cltv_delta,
            destination: details.destination,
            features: details.features,
            id: details.id,
            mtokens: details.mtokens,
            payment: details.payment,
            routes: details.routes,
            tokens: details.tokens,
          });
        } catch (err) {
          return cbk([400, 'ExpectedValidPaymentRequestToBuyPreimage', {err}]);
        }
      }],

      // Subscribe to a probe to a route
      getRoute: ['parseRequest', ({parseRequest}, cbk) => {
        const sub = subscribeToProbeForRoute({
          lnd,
          cltv_delta: parseRequest.cltv_delta + cltvDeltaBuffer,
          destination: parseRequest.destination,
          features: parseRequest.features,
          mtokens: parseRequest.mtokens,
          payment: parseRequest.payment,
          routes: parseRequest.routes,
          total_mtokens: !!parseRequest.payment ? parseRequest.mtokens : null,
        });

        const done = (err, res) => {
          sub.removeAllListeners();

          return cbk(err, res);
        };

        sub.once('end', () => done([503, 'FailedToFindPathToDestination']));
        sub.once('error', err => done(err));
        sub.once('probe_success', ({route}) => done(null, route));

        sub.on('probing', ({route}) => {
          return logger.info({checking_path_with_fee: route.fee});
        });

        return;
      }],

      // Confirm transaction fee
      confirmFee: [
        'getRoute',
        'parseRequest',
        ({getRoute, parseRequest}, cbk) =>
      {
        return ask({
          name: 'pay',
          message: `Pay ${parseRequest.tokens} and ${getRoute.fee} fee?`,
          type: 'confirm',
        },
        cbk);
      }],

      // Pay the request
      pay: [
        'confirmFee',
        'getRoute',
        'parseRequest',
        ({confirmFee, getRoute, parseRequest}, cbk) =>
      {
        if (!confirmFee.pay) {
          return cbk([400, 'PaymentCanceled']);
        }

        logger.info({paying: getRoute.tokens});

        return payViaRoutes({
          lnd,
          id: parseRequest.id,
          routes: [getRoute],
        },
        cbk);
      }],

      // Final payment
      paid: ['parseRequest', 'pay', ({parseRequest, pay}, cbk) => {
        return cbk(null, {
          fee: pay.fee,
          secret: pay.secret,
          tokens: parseRequest.tokens,
        });
      }],
    },
    returnResult({reject, resolve, of: 'paid'}, cbk));
  });
};
