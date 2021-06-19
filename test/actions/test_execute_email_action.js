const {test} = require('@alexbosworth/tap');

const method = require('./../../actions/execute_email_action');

const makeArgs = overrides => {
  const args = {
    env: {
      PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
      PAID_SERVICES_INBOX_EMAIL_TO: 'to',
      PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
    },
    fetch: () => new Promise(resolve => resolve()),
    message: 'message',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Env variables are expected',
    error: [400, 'ExpectedEnvironmentVarsToExecuteEmailAction'],
  },
  {
    args: makeArgs({env: {}}),
    description: 'Configured inbox is expected',
    error: [404, 'InboxServiceNotSupported'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch method is required',
    error: [400, 'ExpectedFetchFunctionToExecuteEmailAction'],
  },
  {
    args: makeArgs({message: undefined}),
    description: 'A message is required',
    error: [400, 'ExpectedMessageToExecuteEmailAction'],
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
