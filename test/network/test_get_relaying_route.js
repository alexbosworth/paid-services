const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {makeLnd} = require('mock-lnd');

const method = require('./../../network/get_relaying_route');

const destination = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const {entries} = Object;
const other = '02531fe6068134503d2723133227c867ac8fa6c83c537e9a44c3c5bdbdcb1fe337';
const relay = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const relaying = [39];
const silent = [];
const source = '03462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b';

// A route found from the destination back to the source goes through hops
const routeThrough = hops => ({hops: hops.map(key => ({public_key: key}))});

// Get the relaying route from a fake LND that knows nodes and a route
const getRoute = async ({nodes, peers, route}) => {
  const lnd = makeLnd({
    graph: {
      nodes: entries(nodes || {}).map(([key, features]) => ({
        features,
        public_key: key,
      })),
    },
    routes: !route ? [] : [route],
  });

  return await method({
    destination,
    lnd,
    source,
    ignore: [],
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
