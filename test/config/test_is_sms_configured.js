const {strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../config/is_sms_configured');

const makeEnv = overrides => {
  const env = {
    PAID_SERVICES_INBOX_SMS_FROM_NUMBER: 'from',
    PAID_SERVICES_INBOX_SMS_TO_NUMBER: 'to',
    PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: 'id',
    PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: 'secret',
  };

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const tests = [
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_SMS_FROM_NUMBER: undefined})},
    description: 'SMS requires from address',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_SMS_TO_NUMBER: undefined})},
    description: 'SMS requires to address',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: undefined})},
    description: 'SMS requires twilo user id',
    expected: false,
  },
  {
    args: {env: makeEnv({PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: undefined})},
    description: 'SMS requires twilo auth token',
    expected: false,
  },
  {
    args: {env: makeEnv({})},
    description: 'SMS is enabled',
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
