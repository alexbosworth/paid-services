const {encodeTlvStream} = require('bolt01');
const {makeLnd} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');

const method = require('./../../services/response_for_inbox');

const encode = records => encodeTlvStream({records}).encoded;

const makeEnv = overrides => {
  const env = {
    PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
    PAID_SERVICES_INBOX_EMAIL_TO: 'to',
    PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
  };

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const makeArgs = overrides => {
  const args = {
    arguments: encode([{
      type: '0', value: Buffer.from('message').toString('hex'),
    }]),
    env: makeEnv({}),
    fetch: () => new Promise(resolve => resolve()),
    id: Buffer.alloc(32).toString('hex'),
    lnd: makeLnd({}),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({arguments: undefined}),
    description: 'Request arguments are expected',
    error: [400, 'ExpectedServiceRequestArgumentsForPaidInbox'],
  },
  {
    args: makeArgs({arguments: 'arguments'}),
    description: 'Valid arguments are expected',
    error: [400, 'ExpectedTlvStreamArgumentsForInboxService'],
  },
  {
    args: makeArgs({env: undefined}),
    description: 'Environment variables are expected',
    error: [400, 'ServerConfigurationMissingForInboxService'],
  },
  {
    args: makeArgs({env: {}}),
    description: 'Configured email or sms is expected',
    error: [404, 'InboxServiceNotSupported'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch function is expected',
    error: [400, 'ExpecedFetchFunctionForInboxService'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Authenticated LND is expected',
    error: [400, 'ExpectedAuthenticatedLndForInboxService'],
  },
  {
    args: makeArgs({env: makeEnv({PAID_SERVICES_INBOX_PRICE: '-1'})}),
    description: 'A valid price is expected',
    error: [500, 'InvalidServerConfigurationOfInboxPrice'],
  },
  {
    args: makeArgs({env: makeEnv({PAID_SERVICES_INBOX_PRICE: '1'})}),
    description: 'A paywall is raised for the message',
    expected: {
      response: {
        paywall: 'lntb1500n1pdn4czkpp5ugdqer05qrrxuchrzkcue94th9w2xzasp9qm7d0yxcgp4uh4kn4qdpa2fjkzep6yprkcmmzv9kzqsmj09c8gmmrw4e8yetwvdujq5n9va6kcct5d9hkucqzysdlghdpua7uvjjkcfj49psxtlqzkp5pdncffdfk2cp3mp76thrl29qhqgzufm503pjj96586n5w6edgw3n66j4rxxs707y4zdjuhyt6qqe5weu4',
        text: 'Pay to deliver your inbox message',
      },
    },
  },
  {
    args: makeArgs({PAID_SERVICES_INBOX_PRICE: '0'}),
    description: 'A free message is delivered',
    expected: {response: {text: 'Message delivered to inbox!'}},
  },
  {
    args: makeArgs({}),
    description: 'A message is delivered',
    expected: {response: {text: 'Message delivered to inbox!'}},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
