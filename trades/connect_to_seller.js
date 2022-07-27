const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetect = require('async/detect');
const asyncDetectSeries = require('async/detectSeries');
const asyncEach = require('async/each');
const asyncMap = require('async/map');
const asyncRetry = require('async/retry');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {removePeer} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const interval = 1000;
const {isArray} = Array;
const times = 10;
const uniq = arr => Array.from(new Set(arr));

/** Connect to a seller

  {
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
    id: <Seller Public Key Hex String>
  }
*/
module.exports = ({lnd, logger, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!logger) {
          return cbk([400, 'ExpectedWinstonLoggerToConnectToSeller']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToConnectToSeller']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfNodesToConnectToSeller']);
        }

        return cbk();
      },

      // Get the channels to see if this is a channel peer
      getChannels: ['validate', ({}, cbk) => {
        return getChannels({lnd, is_active: true}, cbk);
      }],

      // Derive the self public key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Find node connect info to connect to
      getNodes: ['getIdentity', ({getIdentity}, cbk) => {
        return asyncMap(nodes, (connect, cbk) => {
          // Exit early when the node is self
          if (!!connect.node && connect.node.id === getIdentity.public_key) {
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

              const sockets = res.sockets.map(n => n.socket);

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
            if (nodeId === getIdentity.public_key) {
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

      // Remove the peer if there is no channel peer to avoid stale peers
      removePeer: [
        'getChannels',
        'getNodes',
        ({getChannels, getNodes}, cbk) =>
      {
        const ids = getChannels.channels.map(n => n.partner_public_key);

        return asyncEach(getNodes, (node, cbk) => {
          // Exit early when there is no node id
          if (!node || !node.id || ids.includes(node.id)) {
            return cbk();
          }

          return removePeer({lnd, public_key: node.id}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            return asyncRetry({interval, times}, cbk => {
              return getPeers({lnd}, (err, res) => {
                if (!!err) {
                  return cbk(err);
                }

                const peers = res.peers.map(n => n.public_key);

                if (!!peers.includes(node.id)) {
                  return cbk([503, 'FailedToDisconnectSellerPeer']);
                }

                return cbk();
              });
            },
            cbk);
          });
        },
        cbk);
      }],

      // Get the list of connected peers
      getPeers: ['removePeer', ({}, cbk) => getPeers({lnd}, cbk)],

      // Try and connect to a node in order to do p2p messaging
      connect: [
        'getNodes',
        'getPeers',
        'removePeer',
        ({getNodes, getPeers}, cbk) =>
      {
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

      // Confirm the connection
      confirmConnected: ['connect', ({connect}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return getPeers({lnd}, (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            const peer = res.peers.find(n => n.public_key === connect.id);

            if (!peer) {
              return cbk([503, 'FailedToConnectToPeer']);
            }

            if (!peer.bytes_received) {
              return cbk([503, 'FailedToFinalizeConnectionWithPeer']);
            }

            return cbk();
          });
        },
        cbk);
      }],

      // Connected to seller
      connected: ['connect', ({connect}, cbk) => {
        if (!connect) {
          return cbk([503, 'FailedToConnectToNode']);
        }

        return cbk(null, {id: connect.id});
      }],
    },
    returnResult({reject, resolve, of: 'connected'}, cbk));
  });
};
