const {strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../config/is_email_configured');

const makeEnv = overrides => {
  const env = {
    PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
    PAID_SERVICES_INBOX_EMAIL_TO: 'to',
    PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
  };

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const tests = [
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_EMAIL_FROM: undefined})},
    description: 'Email requires from address',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_EMAIL_TO: undefined})},
    description: 'Email requires to address',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_POSTMARK_API_KEY: undefined})},
    description: 'Email requires postmark API key',
    expected: false,
  },
  {
    args: {env: makeEnv({})},
    description: 'Email is enabled',
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
