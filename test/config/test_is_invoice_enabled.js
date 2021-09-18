const {test} = require('@alexbosworth/tap');

const method = require('./../../config/is_invoice_enabled');

const makeEnv = overrides => {
  const env = {};

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const tests = [
  {
    args: {env: makeEnv({})},
    description: 'Create invoice is not enabled',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_INVOICE: '1'})},
    description: 'Invoice creation is turned on',
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
