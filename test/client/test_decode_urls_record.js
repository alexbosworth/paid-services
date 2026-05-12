const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');

const method = require('./../../client/decode_urls_record');

const tests = [
  {
    args: {},
    description: 'URLs encoded is expected',
    error: 'ExpectedEncodedUrlsHexString',
  },
  {
    args: {encoded: 'encoded'},
    description: 'URLs TLV encoded is expected',
    error: 'ExpectedValidTlvStreamForEncodedUrls',
  },
  {
    args: {encoded: encodeTlvStream({
      records: [{type: '0', value: Buffer.from('value').toString('hex')}]},
    ).encoded},
    description: 'URLs are expected',
    error: 'ExpectedArrayOfValidUrlsInUrlsListRecord',
  },
  {
    args: {encoded: encodeTlvStream({
      records: [{
        type: '0',
        value: Buffer.from('http://example.com').toString('hex'),
      }]}).encoded},
    description: 'A URL record is returned',
    expected: {urls: ['http://example.com']},
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
