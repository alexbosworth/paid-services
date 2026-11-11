const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/relays_as_hops');

const a = '02' + '01'.repeat(32);
const b = '02'.repeat(33);
const destination = '02' + '03'.repeat(32);
const relaying = {features: [{bit: 39}]};

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
