const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const lnService = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');

const destination = asKey(1);
const relay = asKey(2);
const other = asKey(3);
const source = asKey(4);

// Nodes that relay onion messages signal feature bit 38 or 39
const relaying = {features: [{bit: 39}]};
const silent = {features: []};

// Routes and node details are faked, so that nothing is looked up
const fakes = {nodes: {}, route: null};

lnService.getNode = ({public_key}, cbk) => {
  const node = fakes.nodes[public_key];

  return !node ? cbk([503, 'UnknownNode']) : cbk(null, node);
};

lnService.getRouteToDestination = ({}, cbk) => cbk(null, {route: fakes.route});

const method = require('./../../network/get_relaying_route');

// A route found from the destination back to the source goes through hops
const routeThrough = hops => ({hops: hops.map(key => ({public_key: key}))});

// Get the relaying route with faked routes and node details
const getRoute = async ({nodes, peers, route}) => {
  fakes.nodes = nodes || {};
  fakes.route = route;

  return await method({
    destination,
    source,
    ignore: [],
    lnd: {},
    peers: (peers || []).map(key => ({public_key: key})),
  });
};

const tests = [
  {
    args: {},
    description: 'Without a route there are no message hops',
    error: [503, 'FailedToFindMessageHopsToDestination'],
  },
  {
    args: {peers: [other], route: routeThrough([relay, source])},
    description: 'The first relay has to be a connected peer',
    expected: {ignore: [{from_public_key: relay, to_public_key: source}]},
  },
  {
    args: {
      nodes: {[relay]: relaying, [other]: silent},
      peers: [relay],
      route: routeThrough([other, relay, source]),
    },
    description: 'Relays that do not relay onion messages are avoided',
    expected: {ignore: [{from_public_key: other}]},
  },
  {
    args: {
      nodes: {[relay]: relaying},
      peers: [relay],
      route: routeThrough([other, relay, source]),
    },
    description: 'Relays whose details are not known are avoided',
    expected: {ignore: [{from_public_key: other}]},
  },
  {
    args: {
      nodes: {[other]: relaying, [relay]: relaying},
      peers: [relay],
      route: routeThrough([other, relay, source]),
    },
    description: 'A route of relaying nodes leads through them to the end',
    expected: {hops: [relay, other, destination]},
  },
  {
    args: {peers: [destination], route: routeThrough([source])},
    description: 'A destination that is a peer is sent to directly',
    expected: {hops: [destination]},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(getRoute(args), error, 'Got expected error');
    }

    deepStrictEqual(await getRoute(args), expected, 'Got expected result');
  });
});
