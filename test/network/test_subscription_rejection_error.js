const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/subscription_rejection_error');

const denied = {code: 7, details: 'permission denied'};
const expired = {code: 2, details: 'verification failed: macaroon expired'};
const unavailable = {code: 14, details: 'read ECONNRESET'};
const unimplemented = {code: 12, details: 'unknown service'};

const tests = [
  {
    args: {},
    description: 'Without an error there is no rejection',
    expected: {},
  },
  {
    args: {err: unavailable},
    description: 'An unavailable LND is not a rejection',
    expected: {},
  },
  {
    args: {err: denied},
    description: 'A denied subscription is a permission error',
    expected: {
      error: [403, 'PermissionDeniedToSubscribeToMessages', {err: denied}],
    },
  },
  {
    args: {err: expired},
    description: 'A denied macaroon is a permission error',
    expected: {
      error: [403, 'PermissionDeniedToSubscribeToMessages', {err: expired}],
    },
  },
  {
    args: {err: unimplemented},
    description: 'A subscription that LND does not know is rejected',
    expected: {
      error: [503, 'SubscriptionToMessagesRejected', {err: unimplemented}],
    },
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
