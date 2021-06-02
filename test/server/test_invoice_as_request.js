const {test} = require('tap');

const method = require('./../../server/invoice_as_request');

const tests = [
  {
    args: {},
    description: 'A reply is expected',
    error: [500, 'ExpectedNetworkNameToMapInvoiceToPaidServiceRequest'],
  },
  {
    args: {
      is_confirmed: true,
      is_push: true,
      network: 'btc',
      payments: [{
        is_confirmed: true,
        messages: [{
          type: '805805',
          value: '0093010101038e0001d0018200790b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d43800105fe0ee6b2800205fe0ee6b2800103000101',
        }],
      }],
    },
    description: 'Invoice data is mapped to a paid service request',
    expected: {
      request: 'lnbc2500u1qpuskf07v3qs6qqqgzqvzq2ps8pqysqqgzqvzq2ps8pqysqqgzqvzq2ps8pqyszqsxs2rzgrrw4czqcm0venx2egrqpq7w393ehf5pfcmx382tjxl3yhcsx5d4tks90vqxg75d4wht32gvjhckp7w45ms008glc2ukggutj38zlf92va7x7qsdgej892uy90t4pcqqg9lc8wdv5qjqfwj9',
      service: {arguments: '000101', type: '1', version: '0'},
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), error, 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
