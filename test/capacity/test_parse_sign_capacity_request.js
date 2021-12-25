const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/parse_sign_capacity_request');

const makeArgs = overrides => {
  const args = {
    id: 'b213832d9ab1d735c42bda931e5be603141f379d05142a40fc1af8e7536cdbaf',
    increase: undefined,
    records: [
      {
        type: '0',
        value: '9e6e9f9ed56c38e0e01d896b6188a050cde7fa48314f533c85156b35abd0b0fd',
      },
      {
        type: '1',
        value: '0100000001afdb6c53e7f81afc402a14059d371f1403e65b1e93da2bc435d7b19a2d8313b2000000000000000000016f100f00000000002200209c0b6154fc22ead29dc861cdbd135245c615a806b5268eb34f8e8d4f4225784200000000',
      },
    ],
    vout: 0,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Parse a sign capacity change request',
    expected: {
      unsigned: '0100000001afdb6c53e7f81afc402a14059d371f1403e65b1e93da2bc435d7b19a2d8313b2000000000000000000016f100f00000000002200209c0b6154fc22ead29dc861cdbd135245c615a806b5268eb34f8e8d4f4225784200000000',
    },
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
