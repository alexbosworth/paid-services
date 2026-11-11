const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../client/decode_nodes_record');

const tests = [
  {
    args: {},
    description: 'Nodes encoded is expected',
    error: 'ExpectedEncodedNodesHexString',
  },
  {
    args: {encoded: Buffer.alloc(35).toString('hex')},
    description: 'Public key list is expected',
    error: 'ExpectedArrayOfPublicKeysInNodeListRecord',
  },
  {
    args: {
      encoded: '02'.repeat(33) + '03'.repeat(33),
    },
    description: 'A node list is returned',
    expected: {
      nodes: [
        Buffer.alloc(33, 2).toString('hex'),
        Buffer.alloc(33, 3).toString('hex'),
      ]
    },
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
