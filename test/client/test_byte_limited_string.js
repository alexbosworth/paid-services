const {strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../client/byte_limited_string');

const tests = [
  {
    args: {limit: 10},
    description: 'A limiter function is returned',
    expected: '3031f09fa794f09f8fbb',
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
      const none = Buffer.from(method(args).limited('')).toString('hex');

      strictEqual(none, '', 'Null result is allowed');

      const res = Buffer.from(method(args).limited('01🧔🏻‍♀️45')).toString('hex');

      strictEqual(res, expected, 'Got expected result');
    }
  });
});
