const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../network/resolve_path_introductions');

const bufferAsHex = buffer => buffer.toString('hex');
const failed = {details: 'unexpected error'};
const key1 = bufferAsHex(Buffer.alloc(33, 2));
const key2 = bufferAsHex(Buffer.alloc(33, 3));
const notFound = {details: 'edge not found'};
const outpoint = `${bufferAsHex(Buffer.alloc(32))}:0`;

// Make a fake LND that knows a channel between two nodes
const makeLnd = err => ({
  default: {
    getChanInfo: ({}, cbk) => cbk(err, {
      capacity: '1',
      chan_point: outpoint,
      channel_id: '1',
      node1_pub: key2,
      node2_pub: key1,
    }),
  },
});

const tests = [
  {
    args: {paths: []},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToResolvePathIntroductions'],
  },
  {
    args: {lnd: makeLnd()},
    description: 'Paths are expected',
    error: [400, 'ExpectedBlindedPathsToResolvePathIntroductions'],
  },
  {
    args: {lnd: makeLnd(), paths: [{introduction_node: key1}]},
    description: 'A path starting at a node is unchanged',
    expected: {paths: [{introduction_node: key1}]},
  },
  {
    args: {lnd: makeLnd(), paths: [{introduction_edge: '0x0x1x0'}]},
    description: 'A path starting at edge direction 0 is the lesser key',
    expected: {
      paths: [{introduction_edge: '0x0x1x0', introduction_node: key1}],
    },
  },
  {
    args: {lnd: makeLnd(), paths: [{introduction_edge: '0x0x1x1'}]},
    description: 'A path starting at edge direction 1 is the greater key',
    expected: {
      paths: [{introduction_edge: '0x0x1x1', introduction_node: key2}],
    },
  },
  {
    args: {
      lnd: makeLnd(notFound),
      paths: [{introduction_edge: '0x0x1x0'}, {introduction_node: key2}],
    },
    description: 'A path over an unknown channel is dropped',
    expected: {paths: [{introduction_node: key2}]},
  },
  {
    args: {
      lnd: makeLnd(failed),
      paths: [{introduction_edge: '0x0x1x0'}, {introduction_node: key2}],
    },
    description: 'A path over a channel that cannot be looked up is dropped',
    expected: {paths: [{introduction_node: key2}]},
  },
  {
    args: {
      lnd: makeLnd(),
      paths: [{hops: [], introduction_edge: '0x0x1x1', key: key1}],
    },
    description: 'A path is returned as it was given with its starting node',
    expected: {
      paths: [{
        hops: [],
        introduction_edge: '0x0x1x1',
        introduction_node: key2,
        key: key1,
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      deepStrictEqual(await method(args), expected, 'Got expected result');
    }
  });
});
