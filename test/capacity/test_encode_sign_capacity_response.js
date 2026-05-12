const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../capacity/encode_sign_capacity_response');

const makeArgs = overrides => {
  const args = {
    id: Buffer.alloc(32).toString('hex'),
    signature: Buffer.alloc(72).toString('hex'),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Encode sign capacity response',
    expected: {
      records: [
        {
          type: '0',
          value: '0000000000000000000000000000000000000000000000000000000000000000',
        },
        {
          type: '1',
          value: '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        },
      ],
    },
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
