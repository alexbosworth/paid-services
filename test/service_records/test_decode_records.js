const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {decodeRecords} = require('./../../service_records');

const tests = [
  {
    args: {encoded: '0101000301ff'},
    description: 'Records are decoded when they are in order',
    expected: {records: [{type: '1', value: '00'}, {type: '3', value: 'ff'}]},
  },
  {
    args: {encoded: ''},
    description: 'An empty stream has no records',
    expected: {records: []},
  },
  {
    args: {encoded: '0301ff010100'},
    description: 'Records out of order are not decoded',
    error: 'ExpectedAscendingRecordTypesInTlvStream',
  },
  {
    args: {encoded: '010100010100'},
    description: 'Records that are repeated are not decoded',
    error: 'ExpectedAscendingRecordTypesInTlvStream',
  },
  {
    args: {encoded: '01fd000100'},
    description: 'Records with lengths that are not minimal are not decoded',
    error: 'ExpectedValidTlvStreamToDecodeRecords',
  },
  {
    args: {encoded: 'zz'},
    description: 'Records that are not hex are not decoded',
    error: 'ExpectedHexTlvStreamToDecodeRecords',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => decodeRecords(args), new Error(error), 'Got error');
    }

    deepStrictEqual(decodeRecords(args), expected, 'Got expected result');
  });
});
