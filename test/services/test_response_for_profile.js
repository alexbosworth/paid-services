const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../services/response_for_profile');

const tests = [
  {
    args: {},
    description: 'Environment variables are expected',
    error: [400, 'ServerConfMissingForNodeProfileResponse'],
  },
  {
    args: {env: {}},
    description: 'No profile',
    error: [404, 'ServiceCurrentlyUnsupported'],
  },
  {
    args: {env: {PAID_SERVICES_PROFILE_FOR_NODE: 'node'}},
    description: 'Service is enabled',
    expected: {response: {text: 'node'}},
  },
  {
    args: {env: {PAID_SERVICES_PROFILE_URLS: 'http://example.com'}},
    description: 'Service is enabled with a URL',
    expected: {response: {links: ['http://example.com'], text: undefined}},
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
