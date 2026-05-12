const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../capacity/fee_for_replacement');

const makeArgs = overrides => {
  const args = {
    capacity: 1e6,
    commit_transaction_fee: 500,
    commit_transaction_weight: 1000,
    decrease: [{output: '00', tokens: 1}],
    increase1: 1,
    tokens_per_vbyte: 1,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Calculate fee for replacement tx',
    expected: {fee: 750},
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
