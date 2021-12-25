const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/parse_accept_request');

const makeArgs = overrides => {
  const args = {
    records: [{
      type: '0',
      value: '1cc3b75541a20987ff2308d3c9c92cb8ee9b9975d698f6f82769d2da2596b76f'
    }],
    open_transaction: '02000000000101ddfc0b95d447db6ccef44a4a22d4e38adf570c2e0983f42a01a6e8076e7bb5420000000000000000000240420f00000000002200202e5eae1260152c8b22c27b85b2cee0729754caa1755f614f4779ab8405d4615aeb91f62901000000160014f44f2cbc9cf0b30458402066460d49090a1cdff10247304402201175d52acbcd349f8ea939408bef630be9931d3c6109e9ae2d035af42e012f3502206b00a1d4e9eecff8d3029ba28fa09ccbff9b57280bc521755146d8dd4cb2e00201210364af1cc058d131eab68a08259371348c58a3b2c336d021e8fbe10e19ae8d280b00000000',
    transaction_id: '6e060748f54776964b42f3144965ccf67dab1bf079301f2016684f15fd01846d',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Accept requests should be parsed',
    expected: {
      transaction: '02000000000101ddfc0b95d447db6ccef44a4a22d4e38adf570c2e0983f42a01a6e8076e7bb5420000000000000000000240420f00000000002200202e5eae1260152c8b22c27b85b2cee0729754caa1755f614f4779ab8405d4615aeb91f62901000000160014f44f2cbc9cf0b30458402066460d49090a1cdff10247304402201175d52acbcd349f8ea939408bef630be9931d3c6109e9ae2d035af42e012f3502206b00a1d4e9eecff8d3029ba28fa09ccbff9b57280bc521755146d8dd4cb2e00201210364af1cc058d131eab68a08259371348c58a3b2c336d021e8fbe10e19ae8d280b00000000',
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
