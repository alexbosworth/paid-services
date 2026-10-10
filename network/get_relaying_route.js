const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getNode} = require('ln-service');
const {getRouteToDestination} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const relaysAsHops = require('./relays_as_hops');
const routeRelays = require('./route_relays');

const tokens = 1;

/** Get a route of nodes that relay a message to a destination, from a
  payment route found from the destination back to self

  When the route cannot be used, the nodes to avoid in the next route are
  given instead.

  {
    destination: <Destination Node Public Key Hex String>
    ignore: [{
      [from_public_key]: <Avoid Route From Node Public Key Hex String>
      [to_public_key]: <Avoid Route To Node Public Key Hex String>
    }]
    lnd: <Authenticated LND API Object>
    peers: [{
      public_key: <Peer Public Key Hex String>
    }]
    source: <Self Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    [hops]: [<Message Hop Public Key Hex String>]
    [ignore]: [{
      [from_public_key]: <Avoid Route From Node Public Key Hex String>
      [to_public_key]: <Avoid Route To Node Public Key Hex String>
    }]
  }
*/
module.exports = ({destination, ignore, lnd, peers, source}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Find a route from the destination back to self
      getRoute: cbk => {
        return getRouteToDestination({
          ignore,
          lnd,
          tokens,
          destination: source,
          is_ignoring_past_failures: true,
          start: destination,
        },
        cbk);
      },

      // Get the nodes that the message goes through on the route
      relays: ['getRoute', ({getRoute}, cbk) => {
        // Exit early when there is no route
        if (!getRoute.route) {
          return cbk([503, 'FailedToFindMessageHopsToDestination']);
        }

        return cbk(null, routeRelays({
          destination,
          peers,
          source,
          route: getRoute.route,
        }));
      }],

      // Get the features of each node, as no features when not known
      getNodes: ['relays', ({relays}, cbk) => {
        return asyncMap(relays.relays || [], (key, cbk) => {
          return getNode({
            lnd,
            is_omitting_channels: true,
            public_key: key,
          },
          (err, res) => cbk(null, !!err ? {features: []} : res));
        },
        cbk);
      }],

      // Check that every node on the route relays messages
      route: ['getNodes', 'relays', ({getNodes, relays}, cbk) => {
        // Exit early when the first hop is not a peer
        if (!!relays.ignore) {
          return cbk(null, {ignore: relays.ignore});
        }

        return cbk(null, relaysAsHops({
          destination,
          nodes: getNodes,
          relays: relays.relays,
        }));
      }],
    },
    returnResult({reject, resolve, of: 'route'}, cbk));
  });
};
