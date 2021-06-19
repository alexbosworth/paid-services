const {encodeTlvStream} = require('bolt01');
const {test} = require('@alexbosworth/tap');

const method = require('./../../records/request_records_as_request');

const encode = records => encodeTlvStream({records}).encoded;

const tests = [
  {
    args: {},
    description: 'An encoded payment request is expected',
    error: 'ExpectectedEncodedPaymentRequestRecordsToDecode',
  },
  {
    args: {
      encoded: '00790b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d43800105fe0ee6b280',
    },
    description: 'A network payment request is expected',
    error: 'ExpectedNetworkNameToDeriveRequestFromRequestRecords',
  },
  {
    args: {encoded: '00', network: 'bitcoin'},
    description: 'A valid TLV stream is expected',
    error: 'ExpectedTlvEncodedPaymentRecordsToDecodeRequest',
  },
  {
    args: {
      encoded: encode([{type: '2', value: 'fa'}]),
      network: 'network',
    },
    description: 'Word count is expected',
    error: 'ExpectedWordCountRecordInPaymentTlvRecord',
  },
  {
    args: {
      encoded: encode([{type: '0', value: 'fd00fc'}]),
      network: 'network',
    },
    description: 'Valid word count is expected',
    error: 'ExpectedPaymentRequestWordCountInRequestRecords',
  },
  {
    args: {
      encoded: encode([{type: '0', value: 'fa'}, {type: '2', value: 'fa'}]),
      network: 'network',
    },
    description: 'Request details are expected',
    error: 'ExpectedEncodedPaymentDetailsInPaymentTlvRecord',
  },
  {
    args: {
      encoded: encode([
        {type: '0', value: 'fa'},
        {type: '1', value: '00'},
        {type: '2', value: 'fd00fc'},
      ]),
      network: 'bitcoin',
    },
    description: 'Valid amount is expected',
    error: 'ExpectedPaymentRequestTokensInPaymentRecords',
  },
  {
    args: {
      encoded: '0001c2017a0b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d4380400205fe0ee6b280',
      network: 'network',
    },
    description: 'A request is returned',
    error: 'ExpectedValidPaymentRequestDetailsToDecodeRecords',
  },
  {
    args: {
      encoded: '0001e801910b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a1fa83632b0b9b29031b7b739b4b232b91039bab83837b93a34b733903a3434b990383937b532b1ba038ec6891345e204145be8a3a99de38e98a39d6a569434e1845c8af7205afcfcc7f425fcd1463e93c32881ead0d6e356d467ec8c02553f9aab15e5738b11f127f00',
      network: 'bitcoin',
    },
    description: 'A zero amount request is returned',
    expected: {
      request: 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w',
    },
  },
  {
    args: {
      encoded: '0001c2017a0b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d4380400205fe0ee6b280',
      network: 'bitcoin',
    },
    description: 'A request is returned',
    expected: {
      request: 'lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp',
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
