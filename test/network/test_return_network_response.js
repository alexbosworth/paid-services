const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {makeLnd} = require('mock-lnd');

const method = require('./../../network/return_network_response');
const {reply} = require('./fixtures/return_network_response');

const bufferAsHex = buffer => buffer.toString('hex');
const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const largeOnionBytes = 32834;
const message = {type: '66', value: '00'};
const peer = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const regularOnionBytes = 1366;
const secret = '01'.repeat(32);

// A message of a number of bytes
const messageOf = bytes => ({type: '66', value: '00'.repeat(bytes)});

// Make a reply path through hops, which starts at the first hop
const makeReply = hops => {
  const [introduction] = hops;

  const {key, path} = blindedPathFromHops({hops});

  return {key, inbound: path, introduction_node: introduction};
};

// Make a fake LND of the identity node, connected to the peer
const makeTestLnd = () => makeLnd({secret, peers: [{public_key: peer}]});

// Return a response and see what was sent and whether a route was looked up
const respond = async args => {
  await method(args);

  const callsTo = method => args.lnd.calls.filter(n => n.method === method);

  return {
    lookups: callsTo('listPeers').length,
    sent: callsTo('sendOnionMessage').map(({args}) => ({
      peer: bufferAsHex(args.peer),
      size: args.onion.length,
    })),
  };
};

const tests = [
  {
    args: {message, reply},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToReturnNetworkResponse'],
  },
  {
    args: {reply, lnd: {}},
    description: 'A message is expected',
    error: [400, 'ExpectedMessageToReturnNetworkResponse'],
  },
  {
    args: {message, lnd: {}},
    description: 'A reply path is expected',
    error: [400, 'ExpectedReplyPathToReturnNetworkResponse'],
  },
  {
    args: {message, reply, lnd: makeTestLnd()},
    description: 'A response is sent back through the reply path',
    expected: {lookups: 1, sent: [{peer, size: regularOnionBytes}]},
  },
  {
    args: {message, lnd: makeTestLnd(), reply: makeReply([identity, peer])},
    description: 'A reply path that starts at self is sent from the next node',
    expected: {lookups: 1, sent: [{peer, size: regularOnionBytes}]},
  },
  {
    args: {
      message,
      reply,
      lnd: makeTestLnd(),
      route: {hops: reply.inbound, key: reply.key, outbound: [peer]},
    },
    description: 'A route to the reply path that is known is sent over',
    expected: {lookups: 0, sent: [{peer, size: regularOnionBytes}]},
  },
  {
    args: {reply, lnd: makeTestLnd(), message: messageOf(2000)},
    description: 'A response that does not fit a regular message is large',
    expected: {lookups: 1, sent: [{peer, size: largeOnionBytes}]},
  },
  {
    args: {
      reply,
      is_regular: true,
      lnd: makeTestLnd(),
      message: messageOf(2000),
    },
    description: 'A regular response has to fit a regular message',
    error: [413, 'ExpectedResponseThatFitsRegularOnionMessage'],
  },
  {
    args: {reply, lnd: makeTestLnd(), message: messageOf(40000)},
    description: 'A response has to fit a large message',
    error: [413, 'ExpectedResponseThatFitsLargeOnionMessage'],
  },
  {
    args: {reply, lnd: makeTestLnd(), message: {type: 'x', value: '00'}},
    description: 'A response that cannot be encoded is an error',
    error: [400, 'FailedToEncodeResponseOnionMessage'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), error, 'Got error');
    }

    deepStrictEqual(await respond(args), expected, 'Got expected result');
  });
});
