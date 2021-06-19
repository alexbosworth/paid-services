const {test} = require('@alexbosworth/tap');

const method = require('./../../actions/execute_sms_action');

const makeArgs = overrides => {
  const args = {
    env: {
      PAID_SERVICES_INBOX_SMS_FROM_NUMBER: 'from',
      PAID_SERVICES_INBOX_SMS_TO_NUMBER: 'to',
      PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: 'id',
      PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: 'pass',
    },
    fetch: () => new Promise(resolve => resolve({status: 200})),
    message: 'message',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Env variables are expected',
    error: [400, 'ExpectedEnvironmentVarsToExecuteSmsAction'],
  },
  {
    args: makeArgs({env: {}}),
    description: 'Configured inbox is expected',
    error: [404, 'InboxServiceNotSupported'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch method is required',
    error: [400, 'ExpectedFetchFunctionToExecuteSmsAction'],
  },
  {
    args: makeArgs({message: undefined}),
    description: 'A message is required',
    error: [400, 'ExpectedMessageToExecuteSmsAction'],
  },
  {
    args: makeArgs({}),
    description: 'An email is sent',
  },
  {
    args: makeArgs({reply: 'reply'}),
    description: 'An email with reply text is sent',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, rejects}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
