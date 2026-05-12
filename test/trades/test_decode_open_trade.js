const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../trades/decode_open_trade');

const tests = [
  {
    args: {},
    description: 'A network name is expected',
    error: 'ExpectedNetworkNameToDecodeOpenTrade',
  },
  {
    args: {network: 'btc'},
    description: 'Records are expected',
    error: 'ExpectedArrayOfRecordsToDecodeOpenTrade',
  },
  {
    args: {network: 'btc', records: []},
    description: 'Nodes are expected',
    error: 'ExpectedNodesRecordToDecodeOpenTradeDetails',
  },
  {
    args: {
      network: 'btc',
      records: [
        {type: '0', value: '01'},
        {type: '4', value: '000a01080000010000020003'},
      ],
    },
    description: 'Open trade is decoded',
    expected: {
      id: undefined,
      network: 'btc',
      nodes: [{high_channel: '1x2x3'}],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      throws(
        () => method(args),
        err => {
          strictEqual(err.message, error, 'Got error');

          return true;
        },
        'Got error'
      );
    } else {
      const res = method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
