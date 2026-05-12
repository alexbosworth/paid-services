const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

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
