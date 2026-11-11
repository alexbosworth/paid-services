const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../p2p/encode_peer_response');

const {keys} = Object;

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {id: '00'};

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Peer response is encoded',
    expected: {message: '626f73ff01010002030001c8'},
  },
  {
    args: makeArgs({records: [{type: '0', value: '00'}]}),
    description: 'Peer response with records is encoded',
    expected: {message: '626f73ff01010002030001c80503000100'},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    const res = method(args);

    deepStrictEqual(res, expected, 'Got expected result');
  });
});
