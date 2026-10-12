const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');

const method = require('./../../network/return_network_response');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const bufferAsHex = buffer => buffer.toString('hex');
const largeOnionBytes = 32834;
const message = {type: '66', value: '00'};
const regularOnionBytes = 1366;
const secret = Buffer.alloc(32, 1);
const sha256 = n => createHash('sha256').update(n).digest();

// The node identity is the key of secret 1, its peer the key of secret 2
const identity = asKey(1);
const peer = asKey(2);

// A message of a number of bytes
const messageOf = bytes => ({type: '66', value: '00'.repeat(bytes)});

// Make a reply path through hops, which starts at the first hop
const makeReply = hops => {
  const [introduction] = hops;

  const {key, path} = blindedPathFromHops({hops});

  return {key, inbound: path, introduction_node: introduction};
};

// A reply path that starts at the peer
const reply = makeReply([peer]);

// Make a fake LND of the identity node, connected to the peer, that records
// the messages it sends and the lookups of its peers
const makeTestLnd = () => {
  const lnd = makeLnd({});

  const {getInfo} = lnd.default;

  lnd.lookups = [];
  lnd.sent = [];

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, identity_pubkey: identity});
  });

  lnd.default.listPeers = ({}, cbk) => {
    lnd.lookups.push(true);

    return cbk(null, {
      peers: [{
        address: '127.0.0.1:9735',
        bytes_recv: '0',
        bytes_sent: '0',
        errors: [],
        features: {},
        flap_count: 0,
        inbound: false,
        last_flap_ns: '0',
        ping_time: '0',
        pub_key: peer,
        sat_recv: '0',
        sat_sent: '0',
        sync_type: 'ACTIVE_SYNC',
      }],
    });
  };

  lnd.default.sendOnionMessage = (args, cbk) => {
    lnd.sent.push({peer: bufferAsHex(args.peer), size: args.onion.length});

    return cbk();
  };

  lnd.signer = {
    deriveSharedKey: ({ephemeral_pubkey}, cbk) => cbk(null, {
      shared_key: sha256(pointMultiply(ephemeral_pubkey, secret, true)),
    }),
  };

  return lnd;
};

// Return a response and see what was sent and whether a route was looked up
const respond = async args => {
  await method(args);

  return {lookups: args.lnd.lookups.length, sent: args.lnd.sent};
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
