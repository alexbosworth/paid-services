const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/assemble_replacement_tx');

const makeArgs = overrides => {
  const args = {
    bitcoinjs_network: 'regtest',
    close_transaction: '020000000001015c07d1d67044b91aa50c232d134a2212cd1594e47a0e0c1324e6606511b800f500000000001cc06980024a01000000000000220020b7993cda6e49931239a7c2f34a7ad8bf0b5bf7237674dfacb596418474441ecdb2340f000000000022002053107a1c940c2c9f2d7094de76dcfbcf78951328004cd6391ac20d468f912fb0040047304402201fd0bc7f064d2bd1583f47d9927b73ff56c33c54fb35fec08c0db02510dcf73f02206912c81373ca2827b8a7dd815c6d33db5d4fb327f3cba8518cd87e3a81c08380014830450221009f5683258870e7e755fd9d0826c50b02a4aeec470ace43c2e042dcaf139379fc0220358509d18e2c8c0f485a51e8ed02d479177fc06692b67cb5c025020c9d337fe40147522103a6064236258e646d216aace3afda9d972b052c5c29c2c1c0907d83177675e8b52103acafeb5309c6a437888ccfadb7d06312bf0fca1963fffdfcba9890c4a233e8a652aee14a4320',
    decrease: [],
    funding_address: 'bcrt1qq6xywqkd2z94gwlkcge4n07u3vmg5zn0t5p2ymarcll23rvrtv3q5w9j04',
    funding_tokens: 987247,
    transaction_id: 'f500b8116560e624130c0e7ae49415cd12224a132d230ca51ab94470d6d1075c',
    transaction_vout: 0,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Assemble a replacement transaction',
    expected: {
      transaction: '01000000015c07d1d67044b91aa50c232d134a2212cd1594e47a0e0c1324e6606511b800f5000000000000000000016f100f0000000000220020068c4702cd508b543bf6c23359bfdc8b368a0a6f5d02a26fa3c7fea88d835b2200000000',
      transaction_id: '17aba571699841d6ed8cd5d0eea97ea2d439295a2883f12daf36763df63131e3',
      transaction_vin: 0,
      transaction_vout: 0,
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
