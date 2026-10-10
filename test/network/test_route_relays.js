const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/route_relays');

const bufferAsHex = buffer => buffer.toString('hex');
const key = n => `02${bufferAsHex(Buffer.alloc(32, n))}`;

const [source, a, b, destination] = [1, 2, 3, 4].map(key);

// A route from the destination back to the source
const route = keys => ({hops: keys.map(n => ({public_key: n}))});

const tests = [
  {
    args: {
      destination,
      source,
      peers: [{public_key: a}],
      route: route([b, a, source]),
    },
    description: 'Relays are the route in between, reversed',
    expected: {relays: [a, b]},
  },
  {
    args: {
      destination,
      source,
      peers: [{public_key: b}],
      route: route([b, a, source]),
    },
    description: 'The first relay is expected to be a connected peer',
    expected: {ignore: [{from_public_key: a, to_public_key: source}]},
  },
  {
    args: {
      destination,
      source,
      peers: [{public_key: destination}],
      route: route([source]),
    },
    description: 'A direct channel with the destination has no relays',
    expected: {relays: []},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
