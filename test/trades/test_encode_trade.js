const {test} = require('@alexbosworth/tap');

const method = require('./../../trades/encode_trade');

const tests = [
  {
    args: {},
    description: 'Trade details are required',
    error: 'ExpectedTradeDetailsToEncode',
  },
  {
    args: {
      secret: {
        auth: '00',
        payload: '11',
        request: 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w',
      },
    },
    description: 'Trade secret is encoded',
    expected: {
      trade: '626f73ff02960001e801910b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a1fa83632b0b9b29031b7b739b4b232b91039bab83837b93a34b733903a3434b990383937b532b1ba038ec6891345e204145be8a3a99de38e98a39d6a569434e1845c8af7205afcfcc7f425fcd1463e93c32881ead0d6e356d467ec8c02553f9aab15e5738b11f127f0003080006000111010100',
    },
  },
  {
    args: {
      connect: {
        network: 'btc',
        nodes: [{
          channels: [{
            id: '1x2x3',
            partner_public_key: Buffer.alloc(33, 2).toString('hex'),
          }],
          id: Buffer.alloc(33, 3).toString('hex'),
          sockets: [],
        }],
      },
    },
    description: 'Trade connect is encoded',
    expected: {trade: '626f73ff000101040c000a01080000010000020003'},
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
