const {test} = require('@alexbosworth/tap');

const method = require('./../../trades/encode_open_trade');

const tests = [
  {
    args: {
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
    description: 'Open trade is encoded',
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
