const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {withoutRecord} = require('./../../service_records');

// Known records, an unknown odd record, and a record after the signature
const encoded = '0101aa' + '0701bb' + 'f040' + '00'.repeat(64) + 'f10100';

const tests = [
  {
    args: {encoded, type: '240'},
    description: 'A record is cut out and every other record is kept',
    expected: {encoded: '0101aa' + '0701bb' + 'f10100'},
  },
  {
    args: {encoded, type: '9'},
    description: 'A record that is not there leaves the stream as it is',
    expected: {encoded},
  },
  {
    args: {encoded: '0701bb' + 'fd00fd02bbcc', type: '7'},
    description: 'A record is cut out before a record with a large type',
    expected: {encoded: 'fd00fd02bbcc'},
  },
  {
    args: {encoded: '0701bb0101aa', type: '7'},
    description: 'A stream that is not valid is not cut',
    error: 'ExpectedAscendingRecordTypesInTlvStream',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => withoutRecord(args), new Error(error), 'Got error');
    }

    deepStrictEqual(withoutRecord(args), expected, 'Got expected result');
  });
});
