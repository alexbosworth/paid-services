const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');

const method = require('./../../network/get_message_hops');

const {entries} = Object;
const identity = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const noRoute = [503, 'FailedToFindMessageHopsToDestination'];
const onlyChannels = [67];
const other = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const partner = '03462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b';
const peer = '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const relay = '02531fe6068134503d2723133227c867ac8fa6c83c537e9a44c3c5bdbdcb1fe337';
const relaying = [38];
const silent = [];

// Get the public key of a secret of 32 bytes of a number
const asKey = n => {
  return Buffer.from(pointFromScalar(Buffer.alloc(32, n))).toString('hex');
};

// A route found from the destination back to self goes through hops
const routeThrough = hops => ({hops: hops.map(key => ({public_key: key}))});

// Routes through relays that do not relay messages, a relay for each route
const silentRelayRoutes = count => Array(count).fill(null).map((n, i) => {
  return routeThrough([asKey(20 + i), peer, identity]);
});

// Make a fake LND with a connected peer, which can require channels, with
// more connected peers, with channels with partners, and which can itself
// require channels. Nodes in the graph have features, and routes to self can
// be found.
const makeTestLnd = (args = {}) => makeLnd({
  channels: (args.partners || []).map(key => ({partner_public_key: key})),
  features: !args.is_self_channels_only ? [] : onlyChannels,
  graph: {
    nodes: entries(args.nodes || {}).map(([key, features]) => ({
      features,
      public_key: key,
    })),
  },
  peers: [peer].concat(args.peers || []).map(key => ({
    features: key === peer && !!args.is_channels_only ? onlyChannels : [],
    public_key: key,
  })),
  routes: args.routes || [],
  secret: '00'.repeat(31) + '01',
});

// Get message hops from a fake LND, counting the routes looked up
const getHops = async ({args, lnd, nodes, routes}) => {
  const fake = makeTestLnd({...lnd, nodes, routes});

  const lookups = () => fake.calls.filter(n => n.method === 'queryRoutes');

  try {
    const {hops} = await method({...args, lnd: fake});

    return {hops, lookups: lookups().length};
  } catch (err) {
    return {err, lookups: lookups().length};
  }
};

const tests = [
  {
    args: {destination: peer},
    description: 'A connected peer is sent to directly',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {destination: peer.toUpperCase()},
    description: 'A connected peer key in uppercase is the same peer',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {destination: Buffer.from(peer, 'hex')},
    description: 'A destination that is not a string returns an error',
    expected: {err: [400, 'ExpectedDestinationToGetMessageHops'], lookups: 0},
  },
  {
    args: {destination: identity},
    description: 'A message is not sent to self',
    expected: {err: [400, 'UnexpectedMessageDestinationIsSelf'], lookups: 0},
  },
  {
    args: {destination: other},
    description: 'Without a route to the destination there are no hops',
    expected: {err: noRoute, lookups: 1},
  },
  {
    args: {destination: other},
    description: 'A destination that is not a peer is reached through peers',
    expected: {hops: [peer, other], lookups: 1},
    nodes: {[peer]: relaying},
    routes: [routeThrough([peer, identity])],
  },
  {
    args: {destination: other},
    description: 'Routes through nodes that do not relay are tried again',
    expected: {hops: [peer, other], lookups: 2},
    nodes: {[peer]: relaying, [relay]: silent},
    routes: [
      routeThrough([relay, peer, identity]),
      routeThrough([peer, identity]),
    ],
  },
  {
    args: {destination: other},
    description: 'Routes that start at a node that is not a peer are retried',
    expected: {hops: [peer, other], lookups: 2},
    nodes: {[peer]: relaying, [relay]: relaying},
    routes: [
      routeThrough([relay, identity]),
      routeThrough([peer, identity]),
    ],
  },
  {
    args: {destination: other},
    description: 'Finding a route is given up after ten tries',
    expected: {err: noRoute, lookups: 10},
    nodes: {[peer]: relaying},
    routes: silentRelayRoutes(11),
  },
  {
    args: {destination: peer},
    description: 'A peer that only takes messages over channels gets a route',
    expected: {hops: [peer], lookups: 1},
    lnd: {is_channels_only: true},
    nodes: {},
    routes: [routeThrough([identity])],
  },
  {
    args: {destination: peer, is_expecting_reply: true},
    description: 'A reply needing a channel comes back from a peer with one',
    expected: {hops: [peer], lookups: 0},
    lnd: {is_self_channels_only: true, partners: [peer]},
  },
  {
    args: {destination: peer, is_expecting_reply: true},
    description: 'A reply that needs a channel is routed back over a channel',
    expected: {hops: [partner, peer], lookups: 1},
    lnd: {is_self_channels_only: true, partners: [partner], peers: [partner]},
    nodes: {[partner]: relaying},
    routes: [routeThrough([partner, identity])],
  },
  {
    args: {destination: peer, is_expecting_reply: true},
    description: 'A reply comes back without a channel when self takes any',
    expected: {hops: [peer], lookups: 0},
  },
  {
    args: {destination: peer},
    description: 'A peer with no channel is sent to when no reply comes back',
    expected: {hops: [peer], lookups: 0},
    lnd: {is_self_channels_only: true},
  },
];

tests.forEach(({args, description, expected, lnd, nodes, routes}) => {
  test(description, async () => {
    const got = await getHops({args, lnd, nodes, routes});

    deepStrictEqual(got, expected, 'Got expected result');
  });
});
