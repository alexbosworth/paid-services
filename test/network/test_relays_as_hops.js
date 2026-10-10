const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/relays_as_hops');

const bufferAsHex = buffer => buffer.toString('hex');
const key = n => `02${bufferAsHex(Buffer.alloc(32, n))}`;
const relaying = {features: [{bit: 39}]};

const [a, b, destination] = [1, 2, 3].map(key);

const tests = [
  {
    args: {destination, nodes: [relaying, relaying], relays: [a, b]},
    description: 'Relaying nodes are hops to the destination',
    expected: {hops: [a, b, destination]},
  },
  {
    args: {destination, nodes: [relaying, {features: []}], relays: [a, b]},
    description: 'Nodes that do not relay messages are avoided',
    expected: {ignore: [{from_public_key: b}]},
  },
  {
    args: {destination, nodes: [], relays: []},
    description: 'No relays means sending to the destination directly',
    expected: {hops: [destination]},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
