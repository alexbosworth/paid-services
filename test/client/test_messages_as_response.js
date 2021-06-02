const {encodeTlvStream} = require('bolt01');
const {test} = require('tap');

const method = require('./../../client/messages_as_response');

const encode = records => encodeTlvStream({records}).encoded;

const tests = [
  {
    args: {},
    description: 'Messages are expected',
    error: 'ExpectedArrayOfMessagesToDerivePaidServiceResponse',
  },
  {
    args: {messages: []},
    description: 'A network is expected',
    error: 'ExpectedNetworkNameToDerivePaidServiceResponse',
  },
  {
    args: {messages: [{type: '80580', value: '00'}], network: 'bitcoin'},
    description: 'A response record is expected',
    error: 'ExpectedResponseRecordInMessages',
  },
  {
    args: {messages: [{type: '805805', value: '00'}], network: 'bitcoin'},
    description: 'A valid response is expected',
    error: 'ExpectedResponseRecordsAsValidTlvStream',
  },
  {
    args: {
      messages: [{type: '805805', value: encode([{type: '1', value: '00'}])}],
      network: 'bitcoin',
    },
    description: 'Valid custom records are expected',
    error: 'ExpectedCustomResponseRecordsAsTlvStream',
  },
  {
    args: {
      messages: [{type: '805805', value: encode([{type: '0', value: '00'}])}],
      network: 'bitcoin',
    },
    description: 'Valid standard records are expected',
    error: 'ExpectedStandardResponseRecordsAsValidTlvStream',
  },
  {
    args: {
      messages: [{type: '805805', value: encode([{
        type: '0',
        value: encode([{
          type: '1',
          value: Buffer.from('text').toString('hex'),
        }]),
      }])}],
      network: 'bitcoin',
    },
    description: 'Valid standard record',
    expected: {text: 'text'},
  },
  {
    args: {
      messages: [{type: '805805', value: encode([{
        type: '0',
        value: encode([{
          type: '3',
          value: Buffer.alloc(33, 3).toString('hex'),
        }]),
      }])}],
      network: 'bitcoin',
    },
    description: 'Valid nodes response',
    expected: {
      nodes: ['030303030303030303030303030303030303030303030303030303030303030303'],
    },
  },
  {
    args: {
      messages: [{type: '805805', value: encode([{
        type: '1',
        value: encode([{type: '1', value: '00'}]),
      }])}],
      network: 'bitcoin',
    },
    description: 'Valid custom record',
    expected: {records: [{type: '1', value: '00'}]},
  },
  {
    args: {
      messages: [{
        type: '805805',
        value: '0011000f0003fd019401084e6f74466f756e64',
      }],
      network: 'bitcoin',
    },
    description: 'An encoded error is returned',
    expected: {error: [404, 'NotFound']},
  },
  {
    args: {
      messages: [{type: '805805', value: encode([{
        type: '0',
        value: encode([{
          type: '4',
          value: encode([{
            type: '0',
            value: Buffer.from('http://example.com').toString('hex'),
          }]),
        }]),
      }])}],
      network: 'bitcoin',
    },
    description: 'An encoded error is returned',
    expected: {links: ['http://example.com']},
  },
  {
    args: {
      messages: [{
        type: '805805',
        value: encode([{
          type: '0',
          value: encode([{
            type: '2',
            value: '0001c2017a0b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d4380400205fe0ee6b280',
          }]),
        }]),
      }],
      network: 'bitcoin',
    },
    description: 'An encoded request is returned',
    expected: {
      paywall: 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp',
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
