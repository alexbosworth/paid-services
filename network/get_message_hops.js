const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {getChannels} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getPeers} = require('ln-service');
const {getWalletInfo} = require('ln-service');
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

  When a reply is expected back along the same nodes, and self only takes
  messages from peers with a channel, a connected destination is only sent to
  directly when it has a channel with self, since the reply comes back from
  it.

  The route is found over the channels that are known, the channels of the
  public graph and the channels of self, so a destination that can only be
  reached through unannounced channels of other nodes, as when self is only
  connected through a peer that is itself private, is not supported.

  {
    destination: <Destination Node Public Key Hex String>
    [is_expecting_reply]: <Reply Comes Back Along the Same Nodes Bool>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    hops: [<Message Hop Public Key Hex String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        // The destination key is a string so that it can be compared
        if (!args.destination || typeof args.destination !== 'string') {
          return cbk([400, 'ExpectedDestinationToGetMessageHops']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetMessageHops']);
        }

        return cbk();
      },

      // Node keys are compared in lowercase, as LND gives them
      key: ['validate', ({}, cbk) => {
        return cbk(null, args.destination.toLowerCase());
      }],

      // Get the connected peers
      getPeers: ['validate', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // A connected destination is a direct hop unless it needs a channel
      isPeer: ['getPeers', 'key', ({getPeers, key}, cbk) => {
        const peer = getPeers.peers.find(n => n.public_key === key);

        return cbk(null, !!peer && !hasBit(peer.features, onlyChannelsBits));
      }],

      // Get the features of self when a reply comes back from the destination
      getFeatures: ['isPeer', ({isPeer}, cbk) => {
        // Exit early when the destination is not sent to directly anyway
        if (!isPeer || !args.is_expecting_reply) {
          return cbk();
        }

        return getWalletInfo({lnd: args.lnd}, cbk);
      }],

      // Get the channels with the destination when the reply needs a channel
      getChannels: ['getFeatures', 'key', ({getFeatures, key}, cbk) => {
        // Exit early when self takes messages from peers without a channel
        if (!getFeatures || !hasBit(getFeatures.features, onlyChannelsBits)) {
          return cbk();
        }

        return getChannels({lnd: args.lnd, partner_public_key: key}, cbk);
      }],

      // A connected destination also has a channel when the reply needs one
      isDirect: ['getChannels', 'isPeer', ({getChannels, isPeer}, cbk) => {
        // Exit early when the channels were not needed
        if (!getChannels) {
          return cbk(null, isPeer);
        }

        return cbk(null, !!getChannels.channels.length);
      }],

      // Get the identity key of self, which routes are found back to
      getIdentity: [
        'getFeatures',
        'isDirect',
        ({getFeatures, isDirect}, cbk) =>
      {
        // Exit early when the destination is sent to directly
        if (isDirect) {
          return cbk();
        }

        // Exit early when the identity key came with the features
        if (!!getFeatures) {
          return cbk(null, {public_key: getFeatures.public_key});
        }

        return getIdentity({lnd: args.lnd}, cbk);
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
            source,
            destination: key,
            lnd: args.lnd,
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
