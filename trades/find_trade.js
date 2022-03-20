const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {returnResult} = require('asyncjs-util');

const connectToSeller = require('./connect_to_seller');
const decodeBasicTrade = require('./decode_basic_trade');
const {makePeerRequest} = require('./../p2p');
const requestTradeById = require('./request_trade_by_id');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeReceiveTrades} = require('./../service_types');
const {serviceTypeRequestTrades} = require('./../service_types');

const findBasicRecord = records => records.find(n => n.type === '1');
const findIdRecord = records => records.find(n => n.type === '0');
const {isArray} = Array;
const makeRequestId = () => randomBytes(32).toString('hex');
const requestTradesTimeoutMs = 1000 * 30;
const tradesRequestIdType = '1';
const uniqBy = (a,b) => a.filter((e,i) => a.findIndex(n => n[b] == e[b]) == i);
const waitForTradesMs = 1000 * 5;

/** Find a trade to purchase

  {
    ask: <Inquirer Ask Function>
    [id]: <Trade Id Encoded Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    nodes: [{
      [high_channel]: <High Key Channel Id String>
      [low_channel]: <Low Key Channel Id String>
      [node]: {
        id: <Node Public Key Id Hex String>
        sockets: [<Peer Socket String>]
      }
    }]
  }

  @returns via cbk or Promise
  {
    [auth]: <Encrypted Payload Auth Hex String>
    [payload]: <Preimage Encrypted Payload Hex String>
    request: <BOLT 11 Payment Request String>
    trade: <Encoded Trade String>
  }
*/
module.exports = ({ask, id, lnd, logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskMethodToFindTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndApiToFindTrade']);
        }

        if (!logger) {
          return cbk([400, 'ExpectedLoggerObjectToFindTrade']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedNodesArrayToFindTrade']);
        }

        return cbk();
      },

      // Connect to the seller
      connect: ['validate', ({}, cbk) => {
        return connectToSeller({lnd, logger, nodes}, cbk);
      }],

      // Send request to node with public key identity
      to: ['connect', ({connect}, cbk) => cbk(null, connect.id)],

      // Request a specific trade
      requestTrade: ['to', asyncReflect(({to}, cbk) => {
        // Exit early when this is an open ended trade request with no id
        if (!id) {
          return cbk();
        }

        return requestTradeById({id, lnd, to}, cbk);
      })],

      // Request an inventory of trades
      requestTrades: ['requestTrade', 'to', ({requestTrade, to}, cbk) => {
        // Exit early when there was a successful request for a specific id
        if (!!requestTrade.value) {
          return cbk();
        }

        const requestId = makeRequestId();
        const service = servicePeerRequests({lnd});
        const trades = [];

        // When the requesting period is over, return the received trades
        const finished = err => {
          service.stop({});

          return !!err ? cbk(err) : cbk(null, {trades});
        };

        service.request({type: serviceTypeReceiveTrades}, (req, res) => {
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

          trades.push(decodeBasicTrade({records: req.records}));

          return res.success({});
        });

        logger.info({requesting_trade_details: true});

        // Once connected, ask for the trade details
        return makePeerRequest({
          lnd,
          to,
          records: [{type: tradesRequestIdType, value: requestId}],
          timeout: requestTradesTimeoutMs,
          type: serviceTypeRequestTrades,
        },
        (err, res) => {
          if (!!err) {
            return finished(err);
          }

          return setTimeout(finished, waitForTradesMs);
        });
      }],

      // Select the desired basic trade
      selectTrade: [
        'requestTrade',
        'requestTrades',
        ({requestTrade, requestTrades}, cbk) =>
      {
        // Exit early when the trade was already selected
        if (!!requestTrade.value) {
          return cbk();
        }

        if (!requestTrades.trades.length) {
          return cbk([404, 'NoTradesFound']);
        }

        const uniqueTrades = uniqBy(requestTrades.trades, 'description');

        const [trade, other] = uniqueTrades;

        // Exit early when there is only a single trade
        if (!other) {
          return cbk(null, trade);
        }

        // Present the possible choices
        return ask({
          choices: uniqueTrades.map(trade => ({
            name: trade.description,
            value: trade.id,
          })),
          message: 'What would you like to buy?',
          name: 'id',
          type: 'list',
        },
        cbk);
      }],

      // Fetch the full trade-secret that was selected
      fetchSelectedTrade: ['selectTrade', 'to', ({selectTrade, to}, cbk) => {
        // Exit early when trade is already known
        if (!selectTrade) {
          return cbk();
        }

        return requestTradeById({lnd, to, id: selectTrade.id}, cbk);
      }],

      // Final trade details
      trade: [
        'fetchSelectedTrade',
        'requestTrade',
        ({fetchSelectedTrade, requestTrade}, cbk) =>
      {
        return cbk(null, fetchSelectedTrade || requestTrade.value);
      }],
    },
    returnResult({reject, resolve, of: 'trade'}, cbk));
  });
};
