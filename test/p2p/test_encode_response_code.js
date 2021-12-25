const {test} = require('@alexbosworth/tap');

const method = require('./../../p2p/encode_response_code');

const makeArgs = overrides => {
  const args = {};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({failure: '00'}),
    description: 'A failure array is expected',
    error: 'ExpectedFailureArrayToEncodeResponseCode',
  },
  {
    args: makeArgs({failure: []}),
    description: 'A failure code is expected',
    error: 'ExpectedErrorCodeToEncodeResponseCode',
  },
  {
    args: makeArgs({}),
    description: 'Encode response code',
    expected: {encoded: '0001c8'},
  },
  {
    args: makeArgs({failure: [400, 'Failure']}),
    description: 'Encode failure code',
    expected: {encoded: '0003fd019001074661696c757265'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
