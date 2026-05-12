const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../services/response_for_network');

const tests = [
  {
    args: {},
    description: 'Environment variables are expected',
    error: [400, 'ServerConfMissingForNodeNetworkResponse'],
  },
  {
    args: {env: {}},
    description: 'No profile',
    error: [404, 'ServiceCurrentlyUnsupported'],
  },
  {
    args: {env: {PAID_SERVICES_NETWORK_NODES: 'nodes'}},
    description: 'Invalid configuration',
    error: [500, 'InvalidNetworkNodesConfiguration'],
  },
  {
    args: {
      env: {
        PAID_SERVICES_NETWORK_NODES: [
          Buffer.alloc(33, 2).toString('hex'),
          Buffer.alloc(33, 3).toString('hex'),
        ].join(','),
      },
    },
    description: 'Service is enabled',
    expected: {
      response: {
        nodes: [
          '020202020202020202020202020202020202020202020202020202020202020202',
          '030303030303030303030303030303030303030303030303030303030303030303',
        ],
      },
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(
        method(args),
        err => {
          deepStrictEqual(err, error, 'Got expected error');

          return true;
        },
        'Got expected error'
      );
    } else {
      const res = await method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
