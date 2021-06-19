const {test} = require('@alexbosworth/tap');

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
