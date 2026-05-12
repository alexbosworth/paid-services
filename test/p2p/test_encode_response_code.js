const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

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
  test(description, () => {
    if (!!error) {
      throws(
        () => method(args),
        err => {
          strictEqual(err.message, error, 'Got error');

          return true;
        },
        'Got error'
      );
    } else {
      const res = method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
