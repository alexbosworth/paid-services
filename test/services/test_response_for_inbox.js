const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');
const {makeLnd} = require('mock-lnd');
const {parsePaymentRequest} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');

const method = require('./../../services/response_for_inbox');

const encode = records => encodeTlvStream({records}).encoded;
const id = Buffer.alloc(32).toString('hex');
const {keys} = Object;
const publicKeyOf = key => Buffer.from(pointFromScalar(key)).toString('hex');
const secret = Buffer.alloc(32, 1);

// Describe a paywall by the payment that it requests
const describePaywall = res => {
  // Exit early when there is no paywall
  if (!res.response.paywall) {
    return res;
  }

  const request = parsePaymentRequest({request: res.response.paywall});

  return {
    response: {
      paywall: {
        description_hash: request.description_hash,
        destination: request.destination,
        tokens: request.tokens,
      },
      text: res.response.text,
    },
  };
};

// Make environment variables, replacing defaults with overrides
const makeEnv = overrides => {
  const env = {
    PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
    PAID_SERVICES_INBOX_EMAIL_TO: 'to',
    PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
  };

  keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {
    arguments: encode([{
      type: '0', value: Buffer.from('message').toString('hex'),
    }]),
    env: makeEnv({}),
    fetch: () => new Promise(resolve => resolve()),
    id,
    lnd: makeLnd({secret: secret.toString('hex')}),
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

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
        paywall: {
          description_hash: id,
          destination: publicKeyOf(secret),
          tokens: 1,
        },
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
  test(description, async () => {
    if (!!error) {
      await rejects(
        method(args),
        err => {
          deepStrictEqual(err, error, 'Got expected error');

          return true;
        },
        'Got expected error'
      );
    } else {
      const res = await method(args);

      deepStrictEqual(describePaywall(res), expected, 'Got expected result');
    }
  });
});
