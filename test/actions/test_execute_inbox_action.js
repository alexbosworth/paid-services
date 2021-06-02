const {encodeTlvStream} = require('bolt01');
const {test} = require('tap');

const method = require('./../../actions/execute_inbox_action');

const encode = records => encodeTlvStream({records}).encoded;

const makeArgs = overrides => {
  const args = {
    arguments: encode([{type: '0', value: Buffer.from('m').toString('hex')}]),
    env: {
      PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
      PAID_SERVICES_INBOX_EMAIL_TO: 'to',
      PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
      PAID_SERVICES_INBOX_SMS_FROM_NUMBER: 'from',
      PAID_SERVICES_INBOX_SMS_TO_NUMBER: 'to',
      PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID: 'id',
      PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN: 'pass',
    },
    fetch: () => new Promise(resolve => resolve({status: 200})),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({arguments: undefined}),
    description: 'Arguments are expected',
    error: [400, 'ExpectedInboxServiceArgumentsToExecuteAction'],
  },
  {
    args: makeArgs({arguments: 'arguments'}),
    description: 'Valid arguments are expected',
    error: [400, 'ExpectedValidTlvStreamEncodedInboxArguments'],
  },
  {
    args: makeArgs({env: undefined}),
    description: 'Env variables are expected',
    error: [400, 'ExpectedEnvVariablesToExecuteInboxAction'],
  },
  {
    args: makeArgs({env: {}}),
    description: 'Configured inbox is expected',
    error: [404, 'InboxServiceNotEnabled'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch method is required',
    error: [400, 'ExpectedFetchFunctionToExecuteInboxAction'],
  },
  {
    args: makeArgs({}),
    description: 'Inbox action is executed',
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
