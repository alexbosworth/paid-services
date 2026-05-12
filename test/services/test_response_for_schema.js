const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');

const method = require('./../../services/response_for_schema');

const tests = [
  {
    args: {arguments: '0003000102', env: {}},
    description: 'Numerical lookup for schema',
    expected: {
      response: {
        records: [{
          type: '2',
          value: Buffer.from('Get a pong response to a ping payment').toString('hex'),
        }],
      },
    },
  },
  {
    args: {
      arguments: encodeTlvStream({
        records: [{
          type: '0',
          value: encodeTlvStream({
            records: [{
              type: '1',
              value: Buffer.from('ping').toString('hex'),
            }],
          }).encoded,
        }],
      }).encoded,
      env: {},
    },
    description: 'Response generated for schema',
    expected: {
      response: {
        records: [
          {type: '1', value: '02'},
          {
            type: '2',
            value: Buffer.from('Get a pong response to a ping payment').toString('hex'),
          },
        ],
      },
    },
  },
  {
    args: {
      arguments: encodeTlvStream({
        records: [{
          type: '0',
          value: encodeTlvStream({
            records: [{
              type: '1',
              value: Buffer.from('inbox').toString('hex'),
            }],
          }).encoded,
        }],
      }).encoded,
      env: {
        PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
        PAID_SERVICES_INBOX_EMAIL_TO: 'to',
        PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
      },
    },
    description: 'Response generated for schema with fields',
    expected: {
      response: {
        records: [
          {type: '1', value: '04'},
          {
            type: '2',
            value: '44656c697665722061206d65737361676520746f2074686973206e6f6465277320696e626f78',
          },
          {
            type: '3',
            value: '0022001b4d65737361676520746f2064656c6976657220746f20696e626f780103fd01180130002b5265706c7920656d61696c2061646472657373206f72206f7468657220636f6e74616374206d6574686f64010190',
          },
        ],
      },
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(
        method(args),
        err => {
          deepStrictEqual(err, error, 'Got expected error');

          return true;
        },
        'Got expected error'
      );
    } else {
      const res = await method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
