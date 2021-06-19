const {encodeTlvStream} = require('bolt01');
const {test} = require('@alexbosworth/tap');

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
