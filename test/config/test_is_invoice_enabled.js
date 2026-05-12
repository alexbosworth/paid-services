const {strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

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

      strictEqual(res, expected, 'Got expected result');
    }
  });
});
