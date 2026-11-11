const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../swaps/request_loop_out');

const {keys} = Object;

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {lnd: {}, macaroon: 'AA==', preimage: '00', recovery: '00'};

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToRequestLoopOut'],
  },
  {
    args: makeArgs({preimage: undefined}),
    description: 'A preimage is expected when a macaroon is specified',
    error: [400, 'ExpectedMacaroonPreimageToRequestLoopOut'],
  },
  {
    args: makeArgs({macaroon: undefined}),
    description: 'A macaroon is expected when a preimage is specified',
    error: [400, 'ExpectedPaidMacaroonToRequestLoopOut'],
  },
  {
    args: makeArgs({recovery: undefined}),
    description: 'A recovery is expected',
    error: [400, 'ExpectedRequestRecoveryToRequestLoopOut'],
  },
];

tests.forEach(({args, description, error}) => {
  test(description, async () => {
    await rejects(method(args), error, 'Got error');
  });
});
