const {test} = require('tap');

const method = require('./../../services/response_for_activity');

const makeEnv = overrides => {
  const env = {PAID_SERVICES_ACTIVITY_VOLUME: '1'};

  Object.keys(overrides).forEach(k => env[k] = overrides[k]);

  return env;
};

const makeArgs = overrides => {
  const args = {
    env: makeEnv({}),
    lnd: {
      default: {
        forwardingHistory: (args, cbk) => {
          // Exit early when paging
          if (args.index_offset !== 0) {
            return cbk(null, {forwarding_events: [], last_offset_index: '1'});
          }

          return cbk(null, {
            forwarding_events: [{
              amt_in: '2',
              amt_in_msat: '2000',
              amt_out: '1',
              amt_out_msat: '1000',
              chan_id_in: '1',
              chan_id_out: '2',
              fee: '1',
              fee_msat: '1000',
              timestamp: (Date.now() / 1e3).toString(),
              timestamp_ns: (Date.now() / 1e3 * 1e9).toString(),
            }],
            last_offset_index: '1',
          });
        },
      },
    },
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Environment variables are expected',
    error: [400, 'ExpectedEnvToGenerateRoutingActivityResponse'],
  },
  {
    args: makeArgs({env: {}}),
    description: 'Enabled routing activity is expected',
    error: [404, 'RoutingActivityServiceNotEnabled'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGenerateRoutingActivityResponse'],
  },
  {
    args: makeArgs({
      lnd: {default: {forwardingHistory: ({}, cbk) => cbk('err')}},
    }),
    description: 'LND returns an error',
    error: [
      503,
      'UnexpectedErrGettingRoutingActivity', {
        err: [503, 'GetForwardingHistoryError', {err: 'err'}],
      },
    ],
  },
  {
    args: makeArgs({
      lnd: {
        default: {
          forwardingHistory: (args, cbk) => {
            return cbk(null, {forwarding_events: [], last_offset_index: '1'});
          },
        },
      },
    }),
    description: 'Routing summary is returned for zero events',
    expected: {
      response: {
        text: '24h: Forwarded payments: 0. Total volume: 0.\n7d: Forwarded payments: 0. Total volume: 0.\n30d: Forwarded payments: 0. Total volume: 0.',
      },
    },
  },
  {
    args: makeArgs({}),
    description: 'Routing summary is returned',
    expected: {
      response: {
        text: '24h: Forwarded payments: 1. Total volume: 0.00000001.\n7d: Forwarded payments: 1. Total volume: 0.00000001.\n30d: Forwarded payments: 1. Total volume: 0.00000001.',
      },
    },
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
        text: '24h: Forwarded payments: 1. Earned fees: 0.00000001.\n7d: Forwarded payments: 1. Earned fees: 0.00000001.\n30d: Forwarded payments: 1. Earned fees: 0.00000001.',
      },
    },
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
