const {test} = require('@alexbosworth/tap');

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
