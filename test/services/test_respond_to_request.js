const {test} = require('tap');

const method = require('./../../services/respond_to_request');

const makeArgs = overrides => {
  const args = {
    env: {},
    fetch: () => {},
    id: Buffer.alloc(32).toString('hex'),
    lnd: {},
    type: '2',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Responding requires env vars',
    error: [500, 'ExpectedKnownConfigurationToRespondToRequest'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'Responding requires a fetch function',
    error: [500, 'ExpectedNodeFetchFunctionToRespondToRequest'],
  },
  {
    args: makeArgs({id: undefined}),
    description: 'Responding requires an id',
    error: [500, 'ExpectedInvoiceidToRespondToRequest'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Responding requires LND',
    error: [500, 'ExpectedBackingLndToRespondToRequest'],
  },
  {
    args: makeArgs({type: undefined}),
    description: 'Responding requires a type number',
    error: [500, 'ExpectedStandardRequestTypeToRespondToRequest'],
  },
  {
    args: makeArgs({}),
    description: 'Responding generates a response',
    expected: {response: {text: 'Pong!'}},
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
