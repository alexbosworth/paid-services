const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {makeForwardsResponse} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');

const responseForActivity = require('./../../services/response_for_activity');

const forwardsFees = '24h: Forwarded payments: 1. Earned fees: 0.00000001.\n7d: Forwarded payments: 1. Earned fees: 0.00000001.\n30d: Forwarded payments: 1. Earned fees: 0.00000001.';
const forwardsVolume = '24h: Forwarded payments: 1. Total volume: 0.00000001.\n7d: Forwarded payments: 1. Total volume: 0.00000001.\n30d: Forwarded payments: 1. Total volume: 0.00000001.';
const {keys} = Object;
const noForwards = '24h: Forwarded payments: 0. Total volume: 0.\n7d: Forwarded payments: 0. Total volume: 0.\n30d: Forwarded payments: 0. Total volume: 0.';

// Make environment variables, replacing defaults with overrides
const makeEnv = overrides => {
  const env = {PAID_SERVICES_ACTIVITY_VOLUME: '1'};

  keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {env: makeEnv({}), lnd: makeLnd({})};

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Get a routing activity response, and check if it assigned a global limit
const isLimitGlobal = async args => {
  await responseForActivity(args);

  return 'limit' in globalThis;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Environment variables are expected',
    error: [400, 'ExpectedEnvToGenerateRoutingActivityResponse'],
    method: responseForActivity,
  },
  {
    args: makeArgs({env: {}}),
    description: 'Enabled routing activity is expected',
    error: [404, 'RoutingActivityServiceNotEnabled'],
    method: responseForActivity,
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGenerateRoutingActivityResponse'],
    method: responseForActivity,
  },
  {
    args: makeArgs({lnd: makeLnd({getForwards: ({}, cbk) => cbk('err')})}),
    description: 'LND returns an error',
    error: [
      503,
      'UnexpectedErrGettingRoutingActivity', {
        err: [503, 'GetForwardingHistoryError', {err: 'err'}],
      },
    ],
    method: responseForActivity,
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getForwards: ({}, cbk) => cbk(null, makeForwardsResponse({offset: 1})),
      }),
    }),
    description: 'Routing summary is returned for zero events',
    expected: {
      response: {
        text: noForwards,
      },
    },
    method: responseForActivity,
  },
  {
    args: makeArgs({}),
    description: 'Routing summary is returned',
    expected: {
      response: {
        text: forwardsVolume,
      },
    },
    method: responseForActivity,
  },
  {
    args: makeArgs({
      env: makeEnv({
        PAID_SERVICES_ACTIVITY_FEES: '1',
        PAID_SERVICES_ACTIVITY_VOLUME: '0',
      }),
    }),
    description: 'Routing summary is returned with fees',
    expected: {
      response: {
        text: forwardsFees,
      },
    },
    method: responseForActivity,
  },
  {
    args: makeArgs({}),
    description: 'Routing activity does not assign globals',
    expected: false,
    method: isLimitGlobal,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
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

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
