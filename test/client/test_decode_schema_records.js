const {test} = require('@alexbosworth/tap');

const method = require('./../../client/decode_schema_records');

const tests = [
  {
    args: {},
    description: 'Schema records are expected',
    error: 'ExpectedArrayOfRecordsToDecodeSchemaRecords',
  },
  {
    args: {records: [{type: '1', value: '04'}]},
    description: 'A description is expected',
    error: 'ExpectedDescriptionRecordInSchemaRecords',
  },
  {
    args: {records: [{type: '1', value: 'fd00fc'}, {type: '2', value: '00'}]},
    description: 'A valid id number is expected',
    error: 'FailedToDecodeSchemaIdRecord',
  },
  {
    args: {
      records: [
        {type: '1', value: '04'},
        {
          type: '2',
          value: '44656c697665722061206d65737361676520746f206e6f646520696e626f78',
        },
        {
          type: '3',
          value: '00',
        },
      ],
    },
    description: 'Valid fields are expected',
    error: 'FailedToDecodeSchemaFields',
  },
  {
    args: {
      records: [
        {type: '1', value: '04'},
        {
          type: '2',
          value: '44656c697665722061206d65737361676520746f206e6f646520696e626f78',
        },
        {
          type: '3',
          value: '0022001b4d65737361676520746f2064656c6976657220746f20696e626f780103fd0118012b00265265706c7920656d61696c2061646472657373206f72206e6f6465207075626c6963206b6579010190',
        },
      ],
    },
    description: 'Schema is returned',
    expected: {
      description: 'Deliver a message to node inbox',
      fields: [
        {
          data: undefined,
          description: 'Message to deliver to inbox',
          limit: 280,
          type: '0',
        },
        {
          data: undefined,
          description: 'Reply email address or node public key',
          limit: 144,
          type: '1',
        },
      ],
      id: '4',
    },
  },
  {
    args: {
      records: [
        {
          type: '2',
          value: '44656c697665722061206d65737361676520746f206e6f646520696e626f78',
        },
      ],
    },
    description: 'Schema is returned without id or fields',
    expected: {
      description: 'Deliver a message to node inbox',
      fields: undefined,
      id: undefined,
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
