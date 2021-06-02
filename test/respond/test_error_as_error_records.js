const {test} = require('tap');

const errorAsErrorRecords = require('./../../respond/error_as_error_records');

const tests = [
  {
    args: {},
    description: 'An error is expected to encode an error record',
    error: 'ExpectedErrorArrayToDeriveErrorRecordsForError',
  },
  {
    args: {error: []},
    description: 'An error is expected to include an error code',
    error: 'ExpectedErrorNumericCodeToDeriveErrorRecordsForError',
  },
  {
    args: {error: [400]},
    description: 'An error is expected to include an error string',
    error: 'ExpectedErrorMessageToEncodeErrorIntoErrorRecords',
  },
  {
    args: {error: [400, 'BadArguments']},
    description: 'An error is encoded as an error record',
    expected: {encoded: '0003fd0190010c426164417267756d656e7473'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => errorAsErrorRecords(args), new Error(error), 'Got error');
    } else {
      const res = errorAsErrorRecords(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
