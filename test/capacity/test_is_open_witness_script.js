const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/is_open_witness_script');

const makeArgs = overrides => {
  const args = {
    script: '5221034523c886226ad5986c0f27883f1dafe87da27dc0b17ae902aa0c04fe87017cd42103cfbabf006b8be8e2f9782f8a3bacef0641780528e0f75a44b43e302362b27e1f52ae',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Test if a witness script is a witness script',
    expected: true,
  },
  {
    args: makeArgs({script: '00'}),
    description: 'Test if a nothing script is a witness script',
    expected: false,
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
