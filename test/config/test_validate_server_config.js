const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../config/validate_server_config');

const makeEnv = overrides => {
  const env = {};

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const tests = [
  {
    args: {},
    description: 'ENV is required',
    error: 'ExpectedEnvironmentVariablesToValidateServerConfig',
  },
  {
    args: {env: makeEnv({PAID_SERVICES_NETWORK_NODES: 'node'})},
    description: 'Valid node key is required',
    error: 'ExpectedCommaSeparatedListOfNetworkNodes',
  },
  {
    args: {env: makeEnv({PAID_SERVICES_PROFILE_URLS: 'url'})},
    description: 'Valid urls are required',
    error: 'ExpectedValidProfileLinksInServerConfig',
  },
  {
    args: {
      env: makeEnv({
        PAID_SERVICES_PROFILE_FOR_NODE: Buffer.alloc(999).toString('hex')
      }),
    },
    description: 'Reasonable profile size is required',
    error: 'ExpectedLessProfileDataForProfileResponse',
  },
  {
    args: {env: makeEnv({})},
    description: 'SMS requires to address',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      throws(
        () => method(args),
        err => {
          strictEqual(err.message, error, 'Got error');

          return true;
        },
        'Got error'
      );
    } else {
      const res = method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
