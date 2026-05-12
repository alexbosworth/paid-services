const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../respond/urls_as_urls_record');

const tests = [
  {
    args: {},
    description: 'An error is expected to encode an error record',
    error: 'ExpectedUrlsToEncodeAsUrlsRecord',
  },
  {
    args: {urls: ['url']},
    description: 'Urls should be valid',
    error: 'ExpectedValidUrlsToEncodeInUrlsRecord',
  },
  {
    args: {urls: ['http://example.com']},
    description: 'A url is encoded as records',
    expected: {encoded: '0012687474703a2f2f6578616d706c652e636f6d'},
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
