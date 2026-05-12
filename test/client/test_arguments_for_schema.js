const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../client/arguments_for_schema');

const tests = [
  {
    args: {},
    description: 'An id or name is expected',
    error: 'ExpectedServiceReferenceToGenerateArgsForSchemaReq',
  },
  {
    args: {id: '2'},
    description: 'Encoded arguments are returned',
    expected: {arguments: '0003000102'},
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
