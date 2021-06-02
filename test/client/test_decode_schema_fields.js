const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {test} = require('tap');

const method = require('./../../client/decode_schema_fields');

const encode = records => encodeTlvStream({records}).encoded;

const tests = [
  {
    args: {},
    description: 'Encoded fields are expected',
    error: 'ExpectedTlvStreamEncodedFieldMetadataToDecodeFields',
  },
  {
    args: {
      encoded: encode([{
        type: '0', value: encode([{type: '1', value: '01'}]),
      }]),
    },
    description: 'A description is expected',
    error: 'ExpectedFieldDescriptionInSchemaFields',
  },
  {
    args: {
      encoded: encode([{
        type: '0', value: encode([
          {
            type: '0', value: Buffer.from('description').toString('hex'),
          },
          {
            type: '1', value: 'fd00fc',
          }
        ]),
      }]),
    },
    description: 'A valid byte limit is expected',
    error: 'ExpectedValidBigSizeEncodedNumberForSchemaByteLimit',
  },
  {
    args: {
      encoded: encode([{
        type: '0', value: encode([
          {
            type: '0', value: Buffer.from('description').toString('hex'),
          },
        ]),
      }]),
    },
    description: 'Fields are returned for a description and a limit',
    expected: {
      fields: [{description: 'description', limit: undefined, type: '0'}],
    },
  },
  {
    args: {
      encoded: '0022001b4d65737361676520746f2064656c6976657220746f20696e626f780103fd0118012b00265265706c7920656d61696c2061646472657373206f72206e6f6465207075626c6963206b6579010190',
    },
    description: 'Fields are returned',
    expected: {
      fields: [
        {
          description: 'Message to deliver to inbox',
          limit: 280,
          type: '0',
        },
        {
          description: 'Reply email address or node public key',
          limit: 144,
          type: '1',
        },
      ],
    },
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
