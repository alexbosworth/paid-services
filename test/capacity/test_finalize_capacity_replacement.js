const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/finalize_capacity_replacement');

const makeArgs = overrides => {
  const args = {
    add_funds_vin: 1,
    add_funds_public_key: '021461d967cd73a0daabfd3307612670a685f875505036fbffe6e8b6ad923b42b4',
    add_funds_signature: '3045022100a2758040f91dafda44b4023f2d3c3c67e5f45cfc0124b3528ab17fe67efc8296022041dcf8fcb7ed7265a51c51bbf2f5256b6e6be99870ca01bd7272ddbdab0b0e58',
    local_public_key: '02aff1b90d7db7d6efc4fce51ab8a862925f5bc1f36a3b481bc78f17c2d2eab6bd',
    local_signature: '3045022100cb108c2828ee90e80aeadbe582fefafcfdecf051d90b64ffd4580c36d212519402200e3460309956f2b0f2104caf6c168d3d9ab8f35729083839bf7f535bb8976143',
    funding_spend_vin: 0,
    remote_signature: '3044022050e76c6cfe9de7cc5e370c26b40ff3538a71efeb8f872e3e1918c1d8efb3bec402207b60ae8486a499a5fb564613970aa9e5f443ad6da1608edff160b61169de91c3',
    transaction: '01000000022f2b7182d7ecec0ff7f5657c6d99c03f7b04044d614e8e851cda7ef99a01b8c80000000000ffffffffc6e674e5f365bdf6b40c21823fee8a9d280f41b71e7b0d8865b0575617b67fb70000000000ffffffff01a31d1200000000002200208331f3c1e41346d1624934cade8330b106f34d7d7159e95cfcceaff1906aecf200000000',
    witness_script: '522102aff1b90d7db7d6efc4fce51ab8a862925f5bc1f36a3b481bc78f17c2d2eab6bd2103f8a30f0d7c65ad71408006d79ee4da62adc9d47b3e752a3ef29c097f3a1e4afc52ae',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Finalize a capacity replacement',
    expected: {
      transaction: '010000000001022f2b7182d7ecec0ff7f5657c6d99c03f7b04044d614e8e851cda7ef99a01b8c80000000000ffffffffc6e674e5f365bdf6b40c21823fee8a9d280f41b71e7b0d8865b0575617b67fb70000000000ffffffff01a31d1200000000002200208331f3c1e41346d1624934cade8330b106f34d7d7159e95cfcceaff1906aecf20400483045022100cb108c2828ee90e80aeadbe582fefafcfdecf051d90b64ffd4580c36d212519402200e3460309956f2b0f2104caf6c168d3d9ab8f35729083839bf7f535bb897614301473044022050e76c6cfe9de7cc5e370c26b40ff3538a71efeb8f872e3e1918c1d8efb3bec402207b60ae8486a499a5fb564613970aa9e5f443ad6da1608edff160b61169de91c30147522102aff1b90d7db7d6efc4fce51ab8a862925f5bc1f36a3b481bc78f17c2d2eab6bd2103f8a30f0d7c65ad71408006d79ee4da62adc9d47b3e752a3ef29c097f3a1e4afc52ae02483045022100a2758040f91dafda44b4023f2d3c3c67e5f45cfc0124b3528ab17fe67efc8296022041dcf8fcb7ed7265a51c51bbf2f5256b6e6be99870ca01bd7272ddbdab0b0e580121021461d967cd73a0daabfd3307612670a685f875505036fbffe6e8b6ad923b42b400000000',
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
