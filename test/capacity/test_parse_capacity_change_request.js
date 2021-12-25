const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/parse_capacity_change_request');

const makeArgs = overrides => {
  const args = {
    from: '0218819f4e0dbab6c6bc434913bace0b69f20d832f68934acd72fc610a9b76fe30',
    records: [
      {
        type: '1',
        value: '2bf4a6bf1b97aff5bbb760f1aa7a5705c885194b4e29d42e5576498107f02361',
      },
      {
        type: '2',
        value: '0000660000010000',
      },
    ],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'A capacity change request should be parsed',
    expected: {
      request: {
        channel: '102x1x0',
        from: '0218819f4e0dbab6c6bc434913bace0b69f20d832f68934acd72fc610a9b76fe30',
        id: '2bf4a6bf1b97aff5bbb760f1aa7a5705c885194b4e29d42e5576498107f02361',
      },
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
