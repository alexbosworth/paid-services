const {test} = require('@alexbosworth/tap');

const method = require('./../../config/is_connect_enabled');

const makeEnv = overrides => {
  const env = {};

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const tests = [
  {
    args: {env: makeEnv({})},
    description: 'Peer connect is not enabled',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_CONNECT: '1'})},
    description: 'Peer connect is turned on',
    expected: true,
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
