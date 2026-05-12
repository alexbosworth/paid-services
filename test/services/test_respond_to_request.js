const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../services/respond_to_request');

const makeArgs = overrides => {
  const args = {
    env: {},
    fetch: () => {},
    id: Buffer.alloc(32).toString('hex'),
    lnd: {},
    network: 'btc',
    to: Buffer.alloc(33).toString('hex'),
    type: '2',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Responding requires env vars',
    error: [400, 'ExpectedKnownConfigurationToRespondToRequest'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'Responding requires a fetch function',
    error: [400, 'ExpectedNodeFetchFunctionToRespondToRequest'],
  },
  {
    args: makeArgs({id: undefined}),
    description: 'Responding requires an id',
    error: [400, 'ExpectedInvoiceidToRespondToRequest'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Responding requires LND',
    error: [400, 'ExpectedBackingLndToRespondToRequest'],
  },
  {
    args: makeArgs({type: undefined}),
    description: 'Responding requires a type number',
    error: [400, 'ExpectedStandardRequestTypeToRespondToRequest'],
  },
  {
    args: makeArgs({}),
    description: 'Responding generates a response',
    expected: {response: {text: 'Pong!'}},
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

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
