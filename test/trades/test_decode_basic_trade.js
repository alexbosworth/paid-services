const {test} = require('@alexbosworth/tap');

const method = require('./../../trades/decode_basic_trade');

const tests = [
  {
    args: {},
    description: 'Records are expected',
    error: 'ExpectedArrayOfRecordsToDecodeBasicTrade',
  },
  {
    args: {records: []},
    description: 'A description record is expected',
    error: 'ExpectedDescriptionRecordToDecodeBasicTrade',
  },
  {
    args: {records: [{type: '2', value: '00'}]},
    description: 'An id record is expected',
    error: 'ExpectedIdRecordToDecodeBasicTradeDetails',
  },
  {
    args: {records: [{type: '1', value: '00'}, {type: '2', value: '00'}]},
    description: 'Basic trade is encoded',
    expected: {description: '\u0000', id: '00'},
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
