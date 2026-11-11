const EventEmitter = require('node:events');
const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../swaps/complete_off_to_on_swap');

const {keys} = Object;

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {
    emitter: new EventEmitter(),
    lnd: {},
    max_fee_deposit: 1,
    max_fee_funding: 1,
    recovery: '00',
    response: '00',
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({emitter: undefined}),
    description: 'An event emitter is expected',
    error: [400, 'ExpectedEventEmitterToCompleteOnchainSwap'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToCompleteOffToOnSwap'],
  },
  {
    args: makeArgs({max_fee_deposit: undefined}),
    description: 'A max deposit routing fee is expected',
    error: [400, 'ExpectedMaxRoutingFeeForDepositInOffToOnSwap'],
  },
  {
    args: makeArgs({max_fee_funding: undefined}),
    description: 'A max funding routing fee is expected',
    error: [400, 'ExpectedMaxRoutingFeeForFundingOffToOnSwap'],
  },
  {
    args: makeArgs({recovery: undefined}),
    description: 'A recovery is expected',
    error: [400, 'ExpectedRecoveryDetailsToCompleteOffToOnSwap'],
  },
  {
    args: makeArgs({response: undefined}),
    description: 'A response is expected',
    error: [400, 'ExpectedRequestResponseToCompleteOffToOnSwap'],
  },
];

tests.forEach(({args, description, error}) => {
  test(description, async () => {
    await rejects(method(args), error, 'Got error');
  });
});
