const {test} = require('tap');

const method = require('./../../services/is_service_enabled');

const tests = [
  {
    args: {env: {}, id: '2'},
    description: 'Service is enabled',
    expected: {is_enabled: true},
  },
  {
    args: {env: {PAID_SERVICES_PROFILE_FOR_NODE: 'my node'}, id: '3'},
    description: 'Profile service is enabled',
    expected: {is_enabled: true},
  },
  {
    args: {env: {}, id: '3'},
    description: 'Profile service is not enabled',
    expected: {is_enabled: false},
  },
  {
    args: {
      env: {
        PAID_SERVICES_PROFILE_FOR_NODE: Buffer.alloc(999).toString('hex'),
      },
      id: '3',
    },
    description: 'Profile service is not enabled',
    expected: {is_enabled: false},
  },
  {
    args: {env: {}, id: '4'},
    description: 'Inbox service is not enabled',
    expected: {is_enabled: false},
  },
  {
    args: {
      env: {
        PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
        PAID_SERVICES_INBOX_EMAIL_TO: 'to',
        PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
      },
      id: '4',
    },
    description: 'Inbox service is enabled',
    expected: {is_enabled: true},
  },
  {
    args: {
      env: {
        PAID_SERVICES_INBOX_SMS_FROM_NUMBER: 'from',
        PAID_SERVICES_INBOX_SMS_TO_NUMBER: 'to',
        PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: 'account',
        PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: 'token',
      },
      id: '4',
    },
    description: 'Inbox service is enabled',
    expected: {is_enabled: true},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    const res = method(args);

    strictSame(res, expected, 'Got expected result');

    return end();
  });
});
