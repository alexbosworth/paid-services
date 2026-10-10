const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const lnService = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const g = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const peer = `03${g}`;

// The identity of the node, which is also the generator point
const identity = `02${g}`;
const other = asKey(2);
const relay = asKey(3);

// Nodes that relay onion messages signal feature bit 38 or 39
const noRoute = [503, 'FailedToFindMessageHopsToDestination'];
const relaying = {features: [{bit: 38}]};
const silent = {features: []};

// Routes are faked, one after another, so that nothing is looked up, and
// the routes that are looked up are counted
const fakes = {lookups: 0, nodes: {}, routes: []};

lnService.getNode = ({public_key}, cbk) => {
  const node = fakes.nodes[public_key];

  return !node ? cbk([503, 'UnknownNode']) : cbk(null, node);
};

lnService.getRouteToDestination = ({}, cbk) => {
  fakes.lookups++;

  return cbk(null, {route: fakes.routes.shift() || null});
};

const method = require('./../../network/get_message_hops');

// A route found from the destination back to self goes through hops
const routeThrough = hops => ({hops: hops.map(key => ({public_key: key}))});

// Make a fake LND with a connected peer, which can require channels
const makeTestLnd = ({is_channels_only} = {}) => {
  const lnd = makeLnd({});

  const {getInfo} = lnd.default;

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, identity_pubkey: identity});
  });

  // Peers that only take messages over channels signal feature bit 66 or 67
  const features = !is_channels_only ? {} : {
    '67': {is_known: true, is_required: false, name: 'only-channels'},
  };

  lnd.default.listPeers = ({}, cbk) => cbk(null, {
    peers: [{
      features,
      address: '127.0.0.1:9735',
      bytes_recv: '0',
      bytes_sent: '0',
      errors: [],
      flap_count: 0,
      inbound: false,
      last_flap_ns: '0',
      ping_time: '0',
      pub_key: peer,
      sat_recv: '0',
      sat_sent: '0',
      sync_type: 'ACTIVE_SYNC',
    }],
  });

  return lnd;
};

// Get message hops with faked routes and node details, counting the lookups
const getHops = async ({args, nodes, routes}) => {
  fakes.lookups = Number();
  fakes.nodes = nodes || {};
  fakes.routes = routes || [];

  try {
    const {hops} = await method(args);

    return {hops, lookups: fakes.lookups};
  } catch (err) {
    return {err, lookups: fakes.lookups};
  }
};

const tests = [
  {
    args: {destination: peer, lnd: makeTestLnd()},
    description: 'A connected peer is sent to directly',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {destination: peer.toUpperCase(), lnd: makeTestLnd()},
    description: 'A connected peer key in uppercase is the same peer',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {destination: Buffer.from(peer, 'hex'), lnd: makeTestLnd()},
    description: 'A destination that is not a string returns an error',
    expected: {err: [400, 'ExpectedDestinationToGetMessageHops'], lookups: 0},
  },
  {
    args: {destination: identity, lnd: makeTestLnd()},
    description: 'A message is not sent to self',
    expected: {err: [400, 'UnexpectedMessageDestinationIsSelf'], lookups: 0},
  },
  {
    args: {destination: other, lnd: makeTestLnd()},
    description: 'Without a route to the destination there are no hops',
    expected: {err: noRoute, lookups: 1},
  },
  {
    args: {destination: other, lnd: makeTestLnd()},
    description: 'A destination that is not a peer is reached through peers',
    expected: {hops: [peer, other], lookups: 1},
    nodes: {[peer]: relaying},
    routes: [routeThrough([peer, identity])],
  },
  {
    args: {destination: other, lnd: makeTestLnd()},
    description: 'Routes through nodes that do not relay are tried again',
    expected: {hops: [peer, other], lookups: 2},
    nodes: {[peer]: relaying, [relay]: silent},
    routes: [
      routeThrough([relay, peer, identity]),
      routeThrough([peer, identity]),
    ],
  },
  {
    args: {destination: other, lnd: makeTestLnd()},
    description: 'Routes that start at a node that is not a peer are retried',
    expected: {hops: [peer, other], lookups: 2},
    nodes: {[peer]: relaying, [relay]: relaying},
    routes: [
      routeThrough([relay, identity]),
      routeThrough([peer, identity]),
    ],
  },
  {
    args: {destination: other, lnd: makeTestLnd()},
    description: 'Finding a route is given up after ten tries',
    expected: {err: noRoute, lookups: 10},
    nodes: {[peer]: relaying, [relay]: silent},
    routes: Array(11).fill(routeThrough([relay, peer, identity])),
  },
  {
    args: {destination: peer, lnd: makeTestLnd({is_channels_only: true})},
    description: 'A peer that only takes messages over channels gets a route',
    expected: {hops: [peer], lookups: 1},
    nodes: {},
    routes: [routeThrough([identity])],
  },
];

tests.forEach(({args, description, expected, nodes, routes}) => {
  test(description, async () => {
    const got = await getHops({args, nodes, routes});

    deepStrictEqual(got, expected, 'Got expected result');
  });
});
