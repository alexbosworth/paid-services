const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const buyPreimage = require('./buy_preimage');
const connectToSeller = require('./connect_to_seller');
const decodeBasicTrade = require('./decode_basic_trade');
const decodeTrade = require('./decode_trade');
const {makePeerRequest} = require('./../p2p');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeReceiveChannelSale} = require('./../service_types');
const {serviceTypeRequestChannelSale} = require('./../service_types');

const findBasicRecord = records => records.find(n => n.type === '1');
const findIdRecord = records => records.find(n => n.type === '0');
const findTradeRecord = records => records.find(n => n.type === '1');
const {isArray} = Array;
const makeRequestId = () => randomBytes(32).toString('hex');
const requestTradeTimeoutMs = 1000 * 30;
const requestTradesTimeoutMs = 1000 * 30;
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const tradeIdRecordType = '0';
const tradesRequestIdType = '1';

/** Purchase a channel

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
          return cbk([400, 'ExpectedAskFunctionToBuyChannel']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToBuyChannel']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToBuyChannel']);
        }

        return cbk();
      },

      // Get the trade data to decode it
      askForTrade: ['validate', ({}, cbk) => {
        return ask({
          name: 'trade',
          message: 'Enter encoded trade',
          type: 'input',
          validate: trade => {
            if (!trade) {
              return false;
            }

            try {
              decodeTrade({trade});
            } catch (err) {
              return 'Failed to parse trade details, try re-entering it?';
            }

            // The trade type should be a connect type
            if (!decodeTrade({trade}).connect) {
              return 'Incorrect type of trade, enter a channel sale trade?';
            }

            return true;
          },
        },
        res => cbk(null, res));
      }],

      // Decode the connect details
      connectDetails: ['askForTrade', ({askForTrade}, cbk) => {
        try {
          const {connect} = decodeTrade({trade: askForTrade.trade});

          if (!connect) {
            return cbk([400, 'ExpectedConnectDetailsInTradeInput']);
          }

          return cbk(null, connect);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Connect to the selling node
      connectToSeller: ['connectDetails', ({connectDetails}, cbk) => {
        return connectToSeller({
          lnd,
          logger,
          nodes: connectDetails.nodes,
        },
        cbk);
      }],

      // Get channels being sold
      requestTrade: ['connectToSeller', ({connectToSeller}, cbk) => {
        const requestId = makeRequestId();
        const service = servicePeerRequests({lnd});

        service.request({type: serviceTypeReceiveChannelSale}, (req, res) => {
          const requestIdRecord = findIdRecord(req.records);

          // Exit early when this is a request for something else
          if (!requestIdRecord || requestIdRecord.value !== requestId) {
            return;
          }

          // Make sure there is a basic trade record in the records
          if (!findBasicRecord(req.records)) {
            return res.failure([400, 'ExpectedBasicTradeRecord']);
          }

          // Make sure the basic trade record is valid
          try {
            decodeBasicTrade({records: req.records});
          } catch (err) {
            return res.failure([400, 'ExpectedValidBasicTradeRecord']);
          }

          const trade = decodeBasicTrade({records: req.records});

          res.success({});

          // Don't listen for more channel sales
          service.stop({});

          return cbk(null, trade);
        });

        logger.info({requesting_trade_details: true});

        // Once connected, ask for the trade details
        return makePeerRequest({
          lnd,
          records: [{type: tradesRequestIdType, value: requestId}],
          timeout: requestTradesTimeoutMs,
          to: connectToSeller.id,
          type: serviceTypeRequestChannelSale,
        },
        (err, res) => {
          if (!!err) {
            service.stop({});

            return cbk(err);
          }

          // A trade will be pinged back into the listening service
          return;
        });
      }],

      // Get the specific trade details
      getTrade: [
        'connectToSeller',
        'requestTrade',
        ({connectToSeller, requestTrade}, cbk) =>
      {
        return makePeerRequest({
          lnd,
          records: [{type: tradeIdRecordType, value: requestTrade.id}],
          timeout: requestTradeTimeoutMs,
          to: connectToSeller.id,
          type: serviceTypeRequestChannelSale,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const tradeRecord = findTradeRecord(res.records);

          if (!tradeRecord) {
            return cbk([503, 'ExpectedTradeRecordFromPeer']);
          }

          try {
            decodeTrade({trade: tradeRecord.value});
          } catch (err) {
            return cbk([503, err.message]);
          }

          const {payment} = decodeTrade({trade: tradeRecord.value});

          if (!payment) {
            return cbk([503, 'ExpectedTradePaymentInResponseForTradeById']);
          }

          return cbk(null, {request: payment.request});
        });
      }],

      // Parse the trade payment request
      requestDetails: ['getTrade', ({getTrade}, cbk) => {
        try {
          return cbk(null, parsePaymentRequest({request: getTrade.request}));
        } catch (err) {
          return cbk([503, 'FailedToParseBuyChannelPaymentRequest', {err}]);
        }
      }],

      // Pay and get the preimage through paying for it
      payForPreimage: [
        'getTrade',
        'requestDetails',
        ({getTrade, requestDetails}, cbk) =>
      {
        logger.info({
          request: getTrade.request,
          purchase: requestDetails.description,
          price: tokensAsBigUnit(requestDetails.tokens),
          to: requestDetails.destination,
        });

        const {request} = getTrade;

        return asyncRetry({
          errorFilter: err => !!isArray(err) && err.slice().shift() >= 500,
        },
        cbk => buyPreimage({ask, lnd, logger, request}, cbk), cbk);
      }],

      // Signal that the payment was made
      finished: ['payForPreimage', ({payForPreimage}, cbk) => {
        logger.info({
          price: payForPreimage.tokens,
          payment_proof: payForPreimage.secret,
          routing_fee: payForPreimage.fee,
        });

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
