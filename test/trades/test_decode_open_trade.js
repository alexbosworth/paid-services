const {test} = require('@alexbosworth/tap');

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
