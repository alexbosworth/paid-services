const {test} = require('tap');

const method = require('./../../client/byte_limited_string');

const tests = [
  {
    args: {limit: 10},
    description: 'A limiter function is returned',
    expected: '3031f09fa794f09f8fbb',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const none = Buffer.from(method(args).limited('')).toString('hex');

      strictSame(none, '', 'Null result is allowed');

      const res = Buffer.from(method(args).limited('01🧔🏻‍♀️45')).toString('hex');

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
