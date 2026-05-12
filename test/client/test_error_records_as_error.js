const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');

const errorRecordsAsError = require('./../../client/error_records_as_error');

const encode = records => encodeTlvStream({records}).encoded;

const tests = [
  {
    args: {},
    description: 'An encoded error is expected',
    error: 'ExpectedEncodedErrorToDecodeErrorRecords',
  },
  {
    args: {encoded: '0'},
    description: 'A valid encoded error is expected',
    error: 'ExpectedValidTlvStreamEncodedError',
  },
  {
    args: {encoded: encode([{type: '1', value: '00'}])},
    description: 'An error code is expected',
    error: 'ExpectedErrorCodeRecordInErrorRecords',
  },
  {
    args: {encoded: encode([
      {type: '0', value: 'fd00fc'},
      {type: '1', value: '00'},
    ])},
    description: 'A valid code is expected',
    error: 'ExpectedValidBigSizeEncodedErrorCode',
  },
  {
    args: {encoded: encode([{type: '0', value: 'fc'}])},
    description: 'A message is expected',
    error: 'ExpectedErrorMessageRecordToDecodeErrorRecordsAsError',
  },
  {
    args: {encoded: '0003fd0190010c426164417267756d656e7473'},
    description: 'An encoded error is returned',
    expected: {error: [400, 'BadArguments']},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      throws(
        () => errorRecordsAsError(args),
        err => {
          strictEqual(err.message, error, 'Got error');

          return true;
        },
        'Got error'
      );
    } else {
      const res = errorRecordsAsError(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
