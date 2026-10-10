const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/make_network_request');

const bufferAsHex = buffer => buffer.toString('hex');
const key = bufferAsHex(Buffer.alloc(33, 2));

const makeArgs = overrides => {
  const args = {
    lnd: {},
    path: {
      key,
      hops: [{encrypted_data: '00', relay_key: key}],
      introduction_node: key,
    },
    type: '0',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToMakeNetworkRequest'],
  },
  {
    args: makeArgs({path: undefined}),
    description: 'A blinded path is expected',
    error: [400, 'ExpectedBlindedPathToMakeNetworkRequest'],
  },
  {
    args: makeArgs({path: {hops: [], introduction_node: key, key}}),
    description: 'Blinded path hops are expected',
    error: [400, 'ExpectedBlindedPathHopsToMakeNetworkRequest'],
  },
  {
    args: makeArgs({path: {hops: [{}], key}}),
    description: 'A path introduction is expected',
    error: [400, 'ExpectedPathIntroductionToMakeNetworkRequest'],
  },
  {
    args: makeArgs({path: {hops: [{}], introduction_node: key}}),
    description: 'A path key is expected',
    error: [400, 'ExpectedBlindedPathKeyToMakeNetworkRequest'],
  },
  {
    args: makeArgs({
      path: {hops: [{}], introduction_node: Buffer.from(key, 'hex'), key},
    }),
    description: 'A path introduction node is a hex public key',
    error: [400, 'ExpectedIntroductionKeyToMakeNetworkRequest'],
  },
  {
    args: makeArgs({path: {hops: [{}], introduction_edge: 1, key}}),
    description: 'A path introduction edge is a string',
    error: [400, 'ExpectedIntroductionEdgeToMakeNetworkRequest'],
  },
  {
    args: makeArgs({timeout: 0}),
    description: 'A timeout is a positive number',
    error: [400, 'ExpectedPositiveTimeoutToMakeNetworkRequest'],
  },
  {
    args: makeArgs({timeout: '1000'}),
    description: 'A timeout is a number',
    error: [400, 'ExpectedPositiveTimeoutToMakeNetworkRequest'],
  },
  {
    args: makeArgs({type: undefined}),
    description: 'A request type is expected',
    error: [400, 'ExpectedTypeToMakeNetworkRequest'],
  },
];

tests.forEach(({args, description, error}) => {
  test(description, async () => {
    await rejects(method(args), error, 'Got error');
  });
});
