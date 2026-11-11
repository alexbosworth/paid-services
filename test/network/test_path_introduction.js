const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/path_introduction');

const key1 = '02'.repeat(33);
const key2 = '03'.repeat(33);

const tests = [
  {
    args: {},
    description: 'A blinded path is expected',
    error: 'ExpectedBlindedPathToDeterminePathIntroduction',
  },
  {
    args: {path: {}},
    description: 'A path introduction is expected',
    error: 'ExpectedPathIntroductionToDeterminePathIntroduction',
  },
  {
    args: {path: {introduction_edge: '1x2x3x0'}},
    description: 'A channel is expected for an edge introduction',
    error: 'ExpectedChannelForPathIntroductionEdge',
  },
  {
    args: {
      channel: {policies: [{public_key: key1}]},
      path: {introduction_edge: '1x2x3x0'},
    },
    description: 'Channel policies are expected for an edge introduction',
    error: 'ExpectedChannelPoliciesForPathIntroductionEdge',
  },
  {
    args: {path: {introduction_node: key1}},
    description: 'An introduction node is the introduction',
    expected: {introduction: key1},
  },
  {
    args: {
      channel: {policies: [{public_key: key2}, {public_key: key1}]},
      path: {introduction_edge: '1x2x3x0'},
    },
    description: 'An edge in direction 0 is the lesser key node',
    expected: {introduction: key1},
  },
  {
    args: {
      channel: {policies: [{public_key: key1}, {public_key: key2}]},
      path: {introduction_edge: '1x2x3x1'},
    },
    description: 'An edge in direction 1 is the greater key node',
    expected: {introduction: key2},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
