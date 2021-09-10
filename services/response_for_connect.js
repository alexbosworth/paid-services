const {addPeer} = require('ln-service');
const asyncAuto = require('async/auto');
const asyncDetectSeries = require('async/detectSeries');
const {decodeTlvStream} = require('bolt01');
const {getNode} = require('ln-service');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {isConnectEnabled} = require('./../config');

const asString = value => Buffer.from(value, 'hex').toString('utf8');
const byteLength = hex => hex.length / 2;
const findSocket = records => records.find(n => n.type === '1');
const maxSocketByteLength = 144;

/** Derive a connect response. The connect service attempts to connect to a
  socket as a LN peer.

  {
    [arguments]: <Arguments TLV Stream Hex String>
    env: <Environment Variables Object>
    lnd: <Authenticated LND API Object>
    to: <Responding To Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    response: {
      text: <Response Text String>
    }
  }
*/
module.exports = ({arguments, env, lnd, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        // Check that the arguments are a valid TLV stream
        if (!!arguments) {
          try {
            decodeTlvStream({encoded: arguments});
          } catch (err) {
            return cbk([400, 'ExpectedTlvStreamArgumentsForConnectService']);;
          }
        }

        if (!env) {
          return cbk([400, 'ExpectedEnvToGenerateConnectResponse']);
        }

        if (!isConnectEnabled({env})) {
          return cbk([404, 'ConnectServiceNotEnabled']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGenerateConnectServiceResponse']);
        }

        return cbk();
      },

      // Derive the socket
      socket: ['validate', ({}, cbk) => {
        // Exit early when there are no arguments
        if (!arguments) {
          return cbk();
        }

        const {records} = decodeTlvStream({encoded: arguments});

        const socket = findSocket(records);

        if (!socket) {
          return cbk();
        }

        if (byteLength(socket.value) > maxSocketByteLength) {
          return cbk([400, 'ExpectedShorterMessageToSendToInbox']);
        }

        return cbk(null, asString(socket.value));
      }],

      // Get the node to find sockets
      getSockets: ['socket', ({socket}, cbk) => {
        // Exit early when a socket is specified
        if (!!socket) {
          return cbk(null, {sockets: [{socket}]});
        }

        return getNode({
          lnd,
          is_omitting_channels: true,
          public_key: to,
        },
        (err, res) => {
          if (!!err) {
            return cbk([404, 'FailedToFindNodeDetailsInGraph']);
          }

          return cbk(null, res);
        });
      }],

      // Add the node
      addNode: ['getSockets', ({getSockets}, cbk) => {
        return asyncDetectSeries(getSockets.sockets, ({socket}, cbk) => {
          return addPeer({
            lnd,
            socket,
            public_key: to,
          },
          err => cbk(null, !err));
        },
        cbk);
      }],

      // Get the list of connected peers
      getPeers: ['addNode', ({}, cbk) => {
        return getPeers({lnd}, (err, res) => {
          if (!!err) {
            return cbk([503, 'FailedToGetListOfPeersToConfirmConnection']);
          }

          return cbk(null, res);
        });
      }],

      // Confirm connection to peer
      confirmConnected: ['getPeers', ({getPeers}, cbk) => {
        const peer = getPeers.peers.find(n => n.public_key === to);

        if (!peer) {
          return cbk([503, 'FailedToConnect']);
        }

        return cbk();
      }],

      // Response to return
      response: ['confirmConnected', ({}, cbk) => {
        return cbk(null, {response: {text: `Connected to ${to}!`}});
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
