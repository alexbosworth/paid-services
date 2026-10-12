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
const partner = asKey(4);
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

// Make a fake LND with a connected peer, which can require channels, with
// more connected peers, with channels with partners, and which can itself
// require channels
const makeTestLnd = (args = {}) => {
  const lnd = makeLnd({});

  const {getInfo, listChannels} = lnd.default;

  // Nodes that only take messages over channels signal feature bit 66 or 67
  const onlyChannels = {
    '67': {is_known: true, is_required: false, name: 'only-channels'},
  };

  lnd.default.getInfo = (a, cbk) => getInfo(a, (err, res) => {
    return cbk(err, {
      ...res,
      features: !args.is_self_channels_only ? {} : onlyChannels,
      identity_pubkey: identity,
    });
  });

  // The channels are with the partners
  lnd.default.listChannels = (a, cbk) => listChannels(a, (err, res) => {
    const [channel] = res.channels;

    return cbk(err, {
      channels: (args.partners || []).map(key => {
        return {...channel, remote_pubkey: key};
      }),
    });
  });

  lnd.default.listPeers = ({}, cbk) => cbk(null, {
    peers: [peer].concat(args.peers || []).map(key => ({
      address: '127.0.0.1:9735',
      bytes_recv: '0',
      bytes_sent: '0',
      errors: [],
      features: key === peer && !!args.is_channels_only ? onlyChannels : {},
      flap_count: 0,
      inbound: false,
      last_flap_ns: '0',
      ping_time: '0',
      pub_key: key,
      sat_recv: '0',
      sat_sent: '0',
      sync_type: 'ACTIVE_SYNC',
    })),
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
  {
    args: {
      destination: peer,
      is_expecting_reply: true,
      lnd: makeTestLnd({is_self_channels_only: true, partners: [peer]}),
    },
    description: 'A reply that needs a channel comes back from a peer with one',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {
      destination: peer,
      is_expecting_reply: true,
      lnd: makeTestLnd({
        is_self_channels_only: true,
        partners: [partner],
        peers: [partner],
      }),
    },
    description: 'A reply that needs a channel is routed back over a channel',
    expected: {hops: [partner, peer], lookups: 1},
    nodes: {[partner]: relaying},
    routes: [routeThrough([partner, identity])],
  },
  {
    args: {destination: peer, is_expecting_reply: true, lnd: makeTestLnd({})},
    description: 'A reply comes back without a channel when self takes any',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {destination: peer, lnd: makeTestLnd({is_self_channels_only: true})},
    description: 'A peer without a channel is sent to when no reply comes back',
    expected: {hops: [peer], lookups: 0},
  },
];

tests.forEach(({args, description, expected, nodes, routes}) => {
  test(description, async () => {
    const got = await getHops({args, nodes, routes});

    deepStrictEqual(got, expected, 'Got expected result');
  });
});
