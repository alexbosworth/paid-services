const {test} = require('@alexbosworth/tap');

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
      encoded: Buffer.alloc(33, 2).toString('hex') + Buffer.alloc(33, 3).toString('hex'),
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
