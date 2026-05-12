const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../trades/encode_open_trade');

const tests = [
  {
    args: {},
    description: 'A network name is required',
    error: 'ExpectedNetworkNameToEncodeOpenTrade',
  },
  {
    args: {network: 'btc'},
    description: 'Nodes array is required',
    error: 'ExpectedArrayOfNodesToEncodeOpenTrade',
  },
  {
    args: {network: 'btc', nodes: []},
    description: 'Nodes are required',
    error: 'ExpectedNodeToReferToInOpenTrade',
  },
  {
    args: {
      network: 'btctestnet',
      nodes: [{
        channels: [{
          id: '1x2x3',
          partner_public_key: Buffer.alloc(33, 2).toString('hex'),
        }],
        id: Buffer.alloc(33, 3).toString('hex'),
        sockets: [],
      }],
    },
    description: 'A network record is added',
    expected: {trade: '626f73ff000101010101040c000a01080000010000020003'},
  },
  {
    args: {
      id: Buffer.alloc(32).toString('hex'),
      network: 'btctestnet',
      nodes: [{
        channels: [{
          id: '1x2x3',
          partner_public_key: Buffer.alloc(33, 2).toString('hex'),
        }],
        id: Buffer.alloc(33, 3).toString('hex'),
        sockets: [],
      }],
    },
    description: 'A trade id record is added',
    expected: {
      trade: '626f73ff000101010101040c000a0108000001000002000305200000000000000000000000000000000000000000000000000000000000000000',
    },
  },
  {
    args: {
      network: 'btc',
      nodes: [{
        channels: [{
          id: '1x2x3',
          partner_public_key: Buffer.alloc(33, 2).toString('hex'),
        }],
        id: Buffer.alloc(33, 3).toString('hex'),
        sockets: [],
      }],
    },
    description: 'Open trade is encoded',
    expected: {trade: '626f73ff000101040c000a01080000010000020003'},
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
