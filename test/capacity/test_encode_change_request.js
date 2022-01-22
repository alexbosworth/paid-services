const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/encode_change_request');

const makeArgs = overrides => {
  const args = {
    channel: '0x0x0',
    decrease: 0,
    id: Buffer.alloc(32).toString('hex'),
    increase: undefined,
    type: 1,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Encode change request parameters',
    expected: {
      records: [
        {
          type: '0',
          value: '01',
        },
        {
          type: '1',
          value: '0000000000000000000000000000000000000000000000000000000000000000',
        },
        {
          type: '2',
          value: '0000000000000000',
        },
        {
          type: '5',
          value: '01',
        },
      ],
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
