const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const EventEmitter = require('node:events');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {pointMultiply} = require('tiny-secp256k1');

const encodePeerRequest = require('./../../p2p/encode_peer_request');
const method = require('./../../network/service_network_messages');
const {serviceNetworkRequests} = require('./../../network');

const bufferAsHex = buffer => buffer.toString('hex');
const g = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const generator = Buffer.from(`02${g}`, 'hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const id = bufferAsHex(Buffer.alloc(32, 1));
const peer = `03${g}`;
const requestId = bufferAsHex(Buffer.alloc(32, 2));
const secret = Buffer.alloc(32, 1);
const sha256 = n => createHash('sha256').update(n).digest();

// The node identity public key for a secret of 32 bytes of 0x01
const identity = bufferAsHex(Buffer.from(pointMultiply(generator, secret)));

const wait = () => new Promise(resolve => setTimeout(resolve, 50));

// RPC uint64 map keys are eight little-endian bytes
const typeAsKey = type => {
  const bytes = Buffer.alloc(8);

  bytes.writeBigUInt64LE(BigInt(type));

  return bytes.toString('latin1');
};

// Make a fake LND that delivers a message and records sent messages
const makeLnd = ({failPeers}) => {
  const sent = [];
  const subscription = new EventEmitter();

  // Getting peers can fail a number of times before it works
  let failures = failPeers || Number();

  subscription.cancel = () => {};

  const lnd = {
    default: {
      listPeers: ({}, cbk) => failures-- > 0 ? cbk('err') : cbk(null, {
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
      }),
      sendOnionMessage: (args, cbk) => {
        sent.push(args);

        return cbk();
      },
      subscribeOnionMessages: () => subscription,
    },
    signer: {
      // Shared keys are derived after a moment, like over the network
      deriveSharedKey: ({ephemeral_pubkey}, cbk) => setImmediate(() => {
        return cbk(null, {
          shared_key: sha256(pointMultiply(ephemeral_pubkey, secret, true)),
        });
      }),
    },
  };

  return {lnd, sent, subscription};
};

// Make an RPC onion message received on a path to self
const makeReceived = ({isLarge, type, value, withReply}) => {
  const path = blindedPathFromHops({id, hops: [identity]});
  const reply = blindedPathFromHops({hops: [peer]});

  const replyPath = {
    blinded_hops: reply.path.map(hop => ({
      blinded_node: hexAsBuffer(hop.relay_key),
      encrypted_data: hexAsBuffer(hop.encrypted_data),
    })),
    blinding_point: hexAsBuffer(reply.key),
    introduction_node: hexAsBuffer(peer),
  };

  return {
    custom_records: {[typeAsKey(type)]: hexAsBuffer(value)},
    encrypted_recipient_data: hexAsBuffer(path.path[0].encrypted_data),
    onion: Buffer.alloc(!isLarge ? 1366 : 32834),
    path_key: hexAsBuffer(path.key),
    peer: hexAsBuffer(peer),
    reply_path: !withReply ? undefined : replyPath,
  };
};

// Summarize the onion messages that were sent
const summary = sent => sent.map(n => ({
  peer: bufferAsHex(n.peer),
  size: n.onion.length,
}));

// Service messages of type 64 with a listener and give the service messages
const serve = async args => {
  const {lnd, sent, subscription} = makeLnd({failPeers: args.fail_peers});
  const got = [];

  const service = method({ids: args.ids, lnd});

  service.end(() => got.push('ended'));
  service.error(err => got.push({err}));

  // A listener can stop the service
  service.message({type: '64'}, (msg, res) => {
    return args.listen(msg, res, n => got.push(n), service);
  });

  args.received.forEach(n => subscription.emit('data', makeReceived(n)));

  // The service can stop while the path ids of messages are decrypted
  if (!!args.is_stopping) {
    service.stop({});
  }

  await wait();

  // The stream of messages can close
  if (!!args.is_ending) {
    subscription.emit('end');
    subscription.emit('data', makeReceived(args.received[0]));

    await wait();
  }

  service.stop({});

  return {got, sent: summary(sent)};
};

// Service requests of type 0 and give the service messages
const serveRequests = async ({is_stopping, received, records}) => {
  const {lnd, sent, subscription} = makeLnd({});
  const got = [];

  const service = serviceNetworkRequests({lnd});

  service.error(err => got.push({err}));

  // The service can be stopped while a response is being sent
  service.request({type: '0'}, (req, res) => {
    got.push(req);

    res.success({records: records || [{type: '1', value: '01'}]});

    return !is_stopping ? undefined : service.stop({});
  });

  received.forEach(n => subscription.emit('data', makeReceived(n)));

  await wait();

  service.stop({});

  return {got, sent: summary(sent)};
};

// Reply with replies that fit, that do not fit, and that have no limit
const replyOfEachSize = (msg, {reply, reply_bytes}, push) => {
  return reply_bytes({type: '66'}, (err, res) => {
    push({bytes: res.bytes, is_large: msg.is_large});

    const fits = bufferAsHex(Buffer.alloc(res.bytes));
    const tooLarge = bufferAsHex(Buffer.alloc(res.bytes + 1));

    return reply({is_regular: true, type: '66', value: fits}, err => {
      push({err});

      return reply({is_regular: true, type: '66', value: tooLarge}, err => {
        push({err});

        return reply({type: '66', value: tooLarge}, err => push({err}));
      });
    });
  });
};

const tests = [
  {
    args: {
      listen: (msg, {reply}, push) => {
        push(msg);

        return reply({type: '66', value: '0102'});
      },
      received: [{type: '64', value: '00', withReply: true}],
    },
    description: 'Messages are passed to listeners with their path id',
    expected: {
      got: [{
        is_large: false,
        path_id: id,
        reply_hops: 1,
        value: '00',
        via: peer,
      }],
      sent: [{peer, size: 1366}],
    },
    method: serve,
  },
  {
    args: {
      listen: replyOfEachSize,
      received: [{type: '64', value: '00', withReply: true}],
    },
    description: 'Replies are limited to the size of their requests',
    expected: {
      got: [
        {bytes: 1209, is_large: false},
        {err: null},
        {err: [413, 'ExpectedResponseThatFitsRegularOnionMessage']},
        {err: null},
      ],
      sent: [{peer, size: 1366}, {peer, size: 32834}],
    },
    method: serve,
  },
  {
    args: {
      listen: (msg, {}, push) => push(msg.is_large),
      received: [{isLarge: true, type: '64', value: '00', withReply: true}],
    },
    description: 'A message in a large onion message is large',
    expected: {got: [true], sent: []},
    method: serve,
  },
  {
    args: {
      ids: [bufferAsHex(Buffer.alloc(32))],
      listen: (msg, {}, push) => push(msg),
      received: [{type: '64', value: '00'}, {type: '66', value: '00'}],
    },
    description: 'Messages without a listener or accepted path are ignored',
    expected: {got: [], sent: []},
    method: serve,
  },
  {
    args: {
      ids: [id.toUpperCase()],
      listen: (msg, {}, push) => push(msg.path_id),
      received: [{type: '64', value: '00'}],
    },
    description: 'Accepted path ids are compared in lowercase',
    expected: {got: [id], sent: []},
    method: serve,
  },
  {
    args: {
      is_ending: true,
      listen: (msg, {}, push) => push(msg.value),
      received: [{type: '64', value: '00'}],
    },
    description: 'The service ends when the stream of messages closes',
    expected: {got: ['00', 'ended'], sent: []},
    method: serve,
  },
  {
    args: {
      is_stopping: true,
      listen: (msg, {reply}, push) => {
        push(msg);

        return reply({type: '66', value: '0102'});
      },
      received: [{type: '64', value: '00', withReply: true}],
    },
    description: 'Messages are not passed to listeners after service stops',
    expected: {got: [], sent: []},
    method: serve,
  },
  {
    args: {ids: ['path'], listen: () => {}, received: []},
    description: 'Accepted path ids are hex',
    error: 'ExpectedHexPathIdsToServiceNetworkMessages',
    method: serve,
  },
  {
    args: {
      ids: [id],
      listen: (msg, {reply}, push) => push(reply),
      received: [{type: '64', value: '00'}],
    },
    description: 'Messages without a reply path have no reply function',
    expected: {got: [undefined], sent: []},
    method: serve,
  },
  {
    args: {
      received: [{
        type: '32769',
        value: encodePeerRequest({id: requestId, type: '0'}).message,
        withReply: true,
      }],
    },
    description: 'Network requests are serviced over network messages',
    expected: {
      got: [{path_id: id, records: [], via: peer}],
      sent: [{peer, size: 1366}],
    },
    method: serveRequests,
  },
  {
    args: {
      received: [{
        type: '32769',
        value: encodePeerRequest({id: requestId, type: '0'}).message,
        withReply: true,
      }],
      records: [{type: '1', value: bufferAsHex(Buffer.alloc(2000))}],
    },
    description: 'A too large response to a regular request is a failure',
    expected: {
      got: [
        {path_id: id, records: [], via: peer},
        {
          err: [
            413,
            'NetworkResponseTooLargeToSend',
            {err: [413, 'ExpectedResponseThatFitsRegularOnionMessage']},
          ],
        },
      ],
      sent: [{peer, size: 1366}],
    },
    method: serveRequests,
  },
  {
    args: {
      received: [{
        isLarge: true,
        type: '32769',
        value: encodePeerRequest({id: requestId, type: '0'}).message,
        withReply: true,
      }],
      records: [{type: '1', value: bufferAsHex(Buffer.alloc(2000))}],
    },
    description: 'A large request can get a large response',
    expected: {
      got: [{path_id: id, records: [], via: peer}],
      sent: [{peer, size: 32834}],
    },
    method: serveRequests,
  },
  {
    args: {
      fail_peers: 1,
      listen: (msg, {reply}, push) => {
        return reply({type: '66', value: '00'}, err => {
          push({err: !!err});

          return reply({type: '66', value: '00'}, err => push({err}));
        });
      },
      received: [{type: '64', value: '00', withReply: true}],
    },
    description: 'A reply can be tried again after finding a route fails',
    expected: {got: [{err: true}, {err: null}], sent: [{peer, size: 1366}]},
    method: serve,
  },
  {
    args: {
      listen: (msg, {reply}, push, service) => {
        reply({type: '66', value: '0102'}, err => push({err}));

        // The service stops while the route to the reply path is found
        return service.stop({});
      },
      received: [{type: '64', value: '00', withReply: true}],
    },
    description: 'A reply being prepared when the service stops is not sent',
    expected: {
      got: [{err: [503, 'ServiceStoppedBeforeReplyWasSent']}],
      sent: [],
    },
    method: serve,
  },
  {
    args: {
      listen: (msg, {reply}, push) => {
        const value = bufferAsHex(Buffer.alloc(33000));

        // A reply that does not fit any onion message is not sent silently
        return reply({type: '66', value}, err => push({err}));
      },
      received: [{isLarge: true, type: '64', value: '00', withReply: true}],
    },
    description: 'A reply too large for a large onion message is an error',
    expected: {
      got: [{err: [413, 'ExpectedResponseThatFitsLargeOnionMessage']}],
      sent: [],
    },
    method: serve,
  },
  {
    args: {
      is_stopping: true,
      received: [{
        type: '32769',
        value: encodePeerRequest({id: requestId, type: '0'}).message,
        withReply: true,
      }],
    },
    description: 'A response being sent when the service stops is dropped',
    expected: {got: [{path_id: id, records: [], via: peer}], sent: []},
    method: serveRequests,
  },
  {
    args: {
      received: [{
        isLarge: true,
        type: '32769',
        value: encodePeerRequest({id: requestId, type: '0'}).message,
        withReply: true,
      }],
      records: [{type: '1', value: bufferAsHex(Buffer.alloc(33000))}],
    },
    description: 'A response too large for any onion message is a failure',
    expected: {
      got: [
        {path_id: id, records: [], via: peer},
        {
          err: [
            413,
            'NetworkResponseTooLargeToSend',
            {err: [413, 'ExpectedResponseThatFitsLargeOnionMessage']},
          ],
        },
      ],
      sent: [{peer, size: 1366}],
    },
    method: serveRequests,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
