const {test} = require('@alexbosworth/tap');

const method = require('./../../respond/messages_for_response');

const tests = [
  {
    args: {
      error: [404, 'NotFound'],
      text: 'NotFound',
    },
    description: 'Errors and text are mutually exclusive',
    error: 'UnexpectedRecordsForErrorResponse',
  },
  {
    args: {},
    description: 'An empty response is valid',
    expected: {messages: [{type: '805805', value: ''}]},
  },
  {
    args: {
      nodes: [Buffer.alloc(33, 3).toString('hex')],
    },
    description: 'A list of nodes is returned',
    expected: {
      messages: [{
        type: '805805',
        value: '00230321030303030303030303030303030303030303030303030303030303030303030303',
      }],
    },
  },
  {
    args: {links: ['https://example.com']},
    description: 'A list of links is returned',
    expected: {
      messages: [{
        type: '805805',
        value: '00170415001368747470733a2f2f6578616d706c652e636f6d',
      }],
    },
  },
  {
    args: {error: [404, 'NotFound']},
    description: 'An error is encoded',
    expected: {
      messages: [{
        type: '805805', value: '0011000f0003fd019401084e6f74466f756e64',
      }],
    },
  },
  {
    args: {
      paywall: 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp',
    },
    description: 'A paywall is returned',
    expected: {
      messages: [{
        type: '805805',
        value: '008802860001c2017a0b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d4380400205fe0ee6b280',
      }],
    },
  },
  {
    args: {
      paywall: 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp',
      records: [{type: '0', value: '00'}],
      text: 'text',
    },
    description: 'A full response is returned',
    expected: {
      messages: [{
        type: '805805',
        value: '008e01047465787402860001c2017a0b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d4380400205fe0ee6b2800103000100',
      }],
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
