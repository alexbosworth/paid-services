const {test} = require('@alexbosworth/tap');

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
