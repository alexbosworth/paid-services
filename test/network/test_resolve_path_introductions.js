const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {makeLnd} = require('mock-lnd');

const method = require('./../../network/resolve_path_introductions');

const failed = {details: 'unexpected error'};
const key1 = '02'.repeat(33);
const key2 = '03'.repeat(33);

// Make a fake LND that knows a channel between the two nodes, or that fails
// to look it up
const makeTestLnd = err => {
  const lnd = makeLnd({
    graph: {
      channels: [{
        id: '0x0x1',
        policies: [{public_key: key2}, {public_key: key1}],
      }],
    },
  });

  if (!!err) {
    lnd.default.getChanInfo = ({}, cbk) => cbk(err);
  }

  return lnd;
};

// A fake LND that does not know the channel
const unknown = () => makeLnd({});

const tests = [
  {
    args: {paths: []},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToResolvePathIntroductions'],
  },
  {
    args: {lnd: makeTestLnd()},
    description: 'Paths are expected',
    error: [400, 'ExpectedBlindedPathsToResolvePathIntroductions'],
  },
  {
    args: {lnd: makeTestLnd(), paths: [{introduction_node: key1}]},
    description: 'A path starting at a node is unchanged',
    expected: {paths: [{introduction_node: key1}]},
  },
  {
    args: {lnd: makeTestLnd(), paths: [{introduction_edge: '0x0x1x0'}]},
    description: 'A path starting at edge direction 0 is the lesser key',
    expected: {
      paths: [{introduction_edge: '0x0x1x0', introduction_node: key1}],
    },
  },
  {
    args: {lnd: makeTestLnd(), paths: [{introduction_edge: '0x0x1x1'}]},
    description: 'A path starting at edge direction 1 is the greater key',
    expected: {
      paths: [{introduction_edge: '0x0x1x1', introduction_node: key2}],
    },
  },
  {
    args: {
      lnd: unknown(),
      paths: [{introduction_edge: '0x0x1x0'}, {introduction_node: key2}],
    },
    description: 'A path over an unknown channel is dropped',
    expected: {paths: [{introduction_node: key2}]},
  },
  {
    args: {
      lnd: makeTestLnd(failed),
      paths: [{introduction_edge: '0x0x1x0'}, {introduction_node: key2}],
    },
    description: 'A path over a channel that cannot be looked up is dropped',
    expected: {paths: [{introduction_node: key2}]},
  },
  {
    args: {
      lnd: makeTestLnd(),
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
