const {test} = require('tap');

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
