const {randomBytes} = require('crypto');

const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetect = require('async/detect');
const asyncDetectSeries = require('async/detectSeries');
const asyncMap = require('async/map');
const asyncReflect = require('async/reflect');
const {getChannel} = require('ln-service');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const decodeBasicTrade = require('./decode_basic_trade');
const {makePeerRequest} = require('./../p2p');
const requestTradeById = require('./request_trade_by_id');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeReceiveChannelSale} = require('./../service_types');
const {serviceTypeRequestChannelSale} = require('./../service_types');
const {serviceTypeReceiveTrades} = require('./../service_types');
const {serviceTypeRequestTrades} = require('./../service_types');

const buyAction = 'buy';
const findBasicRecord = records => records.find(n => n.type === '1');
const findIdRecord = records => records.find(n => n.type === '0');
const {isArray} = Array;
const makeRequestId = () => randomBytes(32).toString('hex');
const requestTradeType = '805005';
const requestTradesTimeoutMs = 1000 * 30;
const tradesRequestIdType = '1';
const uniq = arr => Array.from(new Set(arr));
const uniqBy = (a,b) => a.filter((e,i) => a.findIndex(n => n[b] == e[b]) == i);
const waitForTradesMs = 1000 * 5;

/** Find a trade to purchase

  {
    ask: <Inquirer Ask Function>
    [id]: <Trade Id Encoded Hex String>
    identity: <Own Node Identity Public Key Hex String>
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
    auth: <Encrypted Payload Auth Hex String>
    payload: <Preimage Encrypted Payload Hex String>
    request: <BOLT 11 Payment Request String>
    trade: <Encoded Trade String>
  }
*/
module.exports = ({action, ask, id, identity, lnd, logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!action) {
          return cbk([400, 'ExpectedActionTypeToFindTrade']);
        }

        if (!ask) {
          return cbk([400, 'ExpectedAskMethodToFindTrade']);
        }

        if (!identity) {
          return cbk([400, 'ExpectedIdentityToFindTrade']);
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

      // Find node connect info to connect to
      getNodes: ['validate', ({}, cbk) => {
        return asyncMap(nodes, (connect, cbk) => {
          // Exit early when the node is self
          if (!!connect.node && connect.node.id === identity) {
            return cbk();
          }

          // Exit early when the node id and sockets is specified directly
          if (!!connect.node) {
            return getNode({
              lnd,
              is_omitting_channels: true,
              public_key: connect.node.id,
            },
            (err, res) => {
              if (!!err) {
                return cbk(null, connect.node);
              }

              const sockets = connect.node.sockets.map(n => n.socket);

              return cbk(null, {
                id: connect.node.id,
                sockets: uniq([].concat(sockets).concat(connect.node.sockets)),
              });
            });
          }

          // Exit early when there is no landmark channel
          if (!connect.high_channel && !connect.low_channel) {
            return cbk();
          }

          const channelId = connect.high_channel || connect.low_channel;

          // Get the public keys of the landmark channel
          return getChannel({lnd, id: channelId}, (err, res) => {
            // Exit early when the channel cannot be fetched
            if (!!err) {
              return cbk();
            }

            const [low, high] = res.policies.map(n => n.public_key);

            // The node key is either the lower or the higher public key
            const nodeId = !!connect.low_channel ? low : high;

            // Exit early when the node is self
            if (nodeId === identity) {
              return cbk();
            }

            // Find the sockets for the node
            return getNode({
              lnd,
              is_omitting_channels: true,
              public_key: nodeId,
            },
            (err, res) => {
              if (!!err) {
                return cbk();
              }

              return cbk(null, {
                id: nodeId,
                sockets: res.sockets.map(n => n.socket),
              });
            });
          });
        },
        cbk);
      }],

      // Get the list of connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd}, cbk)],

      // Try and connect to a node in order to do p2p messaging
      connect: ['getNodes', 'getPeers', ({getNodes, getPeers}, cbk) => {
        const connected = getPeers.peers.map(n => n.public_key);

        // Look for a node that is already a connected peer
        const [alreadyConnected] = getNodes.filter(node => {
          return !!node && connected.includes(node.id);
        });

        // Exit early when already connected to a node
        if (!!alreadyConnected) {
          return cbk(null, alreadyConnected);
        }

        // Try and connect to a referenced node
        return asyncDetect(getNodes.filter(n => !!n), (node, cbk) => {
          logger.info({connecting_to: node.id});

          // Attempt referenced sockets to establish p2p connection
          return asyncDetectSeries(node.sockets, (socket, cbk) => {
            return addPeer({lnd, socket, public_key: node.id}, err => {
              // Stop trying sockets when there is no error
              return cbk(null, !err);
            });
          },
          (err, socket) => {
            if (!!err) {
              return cbk(err);
            }

            // The node is connected if one of the sockets worked
            return cbk(null, !!socket);
          });
        },
        cbk);
      }],

      // Node to request trades from
      to: ['connect', ({connect}, cbk) => {
        if (!connect) {
          return cbk([503, 'FailedToConnectToNode']);
        }

        return cbk(null, connect.id);
      }],

      // Request a specific trade
      requestTrade: ['to', asyncReflect(({to}, cbk) => {
        // Exit early when this is an open ended trade request with no id
        if (!id) {
          return cbk();
        }

        return requestTradeById({action, id, lnd, to}, cbk);
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

        // Listen for trades
        const receiveType = action === buyAction ? serviceTypeReceiveChannelSale : serviceTypeReceiveTrades;

        service.request({type: receiveType}, (req, res) => {
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

        const requestType = action === buyAction ? serviceTypeRequestChannelSale : serviceTypeRequestTrades;

        // Once connected, ask for the trade details
        return makePeerRequest({
          lnd,
          to,
          records: [{type: tradesRequestIdType, value: requestId}],
          timeout: requestTradesTimeoutMs,
          type: requestType,
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

        return requestTradeById({action, lnd, to, id: selectTrade.id}, cbk);
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
