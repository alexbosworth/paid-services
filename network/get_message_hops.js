const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {getIdentity} = require('ln-service');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getRelayingRoute = require('./get_relaying_route');

const hasBit = (list, bits) => !!(list || []).find(n => bits.includes(n.bit));
const isRetry = err => !!err && err[1] === 'RetryWithoutIgnoredNodes';
const maxAttempts = 10;
const onlyChannelsBits = [66, 67];

/** Get a series of nodes to relay a message to a destination

  A connected destination is sent to directly, unless it signals feature bit
  66 or 67, `option_onion_messages_only_channels`, that it only takes
  messages from peers with a channel. Otherwise the message goes back along a
  payment route found from the destination to self, through nodes that relay
  messages.

  {
    destination: <Destination Node Public Key Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    hops: [<Message Hop Public Key Hex String>]
  }
*/
module.exports = ({destination, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        // The destination key is a string so that it can be compared
        if (!destination || typeof destination !== 'string') {
          return cbk([400, 'ExpectedDestinationToGetMessageHops']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetMessageHops']);
        }

        return cbk();
      },

      // Node keys are compared in lowercase, as LND gives them
      key: ['validate', ({}, cbk) => cbk(null, destination.toLowerCase())],

      // Get the connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd}, cbk)],

      // A connected destination is sent to directly unless it needs a channel
      isDirect: ['getPeers', 'key', ({getPeers, key}, cbk) => {
        const peer = getPeers.peers.find(n => n.public_key === key);

        return cbk(null, !!peer && !hasBit(peer.features, onlyChannelsBits));
      }],

      // Get the identity key of self, which routes are found back to
      getIdentity: ['isDirect', ({isDirect}, cbk) => {
        // Exit early when the destination is sent to directly
        if (isDirect) {
          return cbk();
        }

        return getIdentity({lnd}, cbk);
      }],

      // Find a series of nodes to relay the message
      hops: [
        'getIdentity',
        'getPeers',
        'isDirect',
        'key',
        ({getIdentity, getPeers, isDirect, key}, cbk) =>
      {
        // Exit early when the destination is sent to directly
        if (isDirect) {
          return cbk(null, {hops: [key]});
        }

        const source = getIdentity.public_key;

        if (key === source) {
          return cbk([400, 'UnexpectedMessageDestinationIsSelf']);
        }

        const ignore = [];

        // Find a route of nodes that relay messages, trying again without the
        // nodes that do not
        return asyncRetry({errorFilter: isRetry, times: maxAttempts}, cbk => {
          return getRelayingRoute({
            ignore,
            lnd,
            source,
            destination: key,
            peers: getPeers.peers,
          },
          (err, res) => {
            if (!!err) {
              return cbk(err);
            }

            // Exit early when the route has nodes to use
            if (!!res.hops) {
              return cbk(null, {hops: res.hops});
            }

            res.ignore.forEach(n => ignore.push(n));

            return cbk([503, 'RetryWithoutIgnoredNodes']);
          });
        },
        (err, res) => {
          // Exit early when every attempt found nodes that do not relay
          if (isRetry(err)) {
            return cbk([503, 'FailedToFindMessageHopsToDestination']);
          }

          return cbk(err, res);
        });
      }],
    },
    returnResult({reject, resolve, of: 'hops'}, cbk));
  });
};
