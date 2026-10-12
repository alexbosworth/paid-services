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

// Errors that the stream of messages can fail with
const denied = {code: 7, details: 'permission denied'};
const unavailable = {code: 14, details: 'read ECONNRESET'};

// The error reported when the stream fails with an unavailable LND
const failed = [503, 'NetworkMessagesSubscriptionFailed', {err: unavailable}];
const unimplemented = {code: 12, details: 'unknown service'};
const unsupported = {details: 'unknown method SubscribeOnionMessages'};
const unverified = {code: 2, details: 'verification failed: bad signature'};

// RPC uint64 map keys are eight little-endian bytes
const typeAsKey = type => {
  const bytes = Buffer.alloc(8);

  bytes.writeBigUInt64LE(BigInt(type));

  return bytes.toString('latin1');
};

// Make a fake LND that delivers messages on each subscription to them, and
// records sent messages, and that can stop giving subscriptions
const makeLnd = ({failPeers, subscribes}) => {
  const sent = [];
  const subscriptions = [];

  // Getting peers can fail a number of times before it works
  let failures = failPeers || Number();

  // Each subscription to messages is a new stream, while there are more
  const subscribe = () => {
    if (subscriptions.length === subscribes) {
      throw new Error('ChannelClosed');
    }

    const subscription = new EventEmitter();

    subscription.cancel = () => {};

    subscriptions.push(subscription);

    return subscription;
  };

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
      subscribeOnionMessages: subscribe,
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

  return {lnd, sent, subscriptions};
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
  const {lnd, sent, subscriptions} = makeLnd({failPeers: args.fail_peers});
  const got = [];

  const service = method({lnd, delay: args.delay, ids: args.ids});

  const [subscription] = subscriptions;

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

  service.stop({});

  return {got, sent: summary(sent)};
};

// Service messages, fail the stream with events, and see if the stream is
// subscribed to again after the delay, with messages on the new stream
// reaching the listener
const resubscribe = async args => {
  const {lnd, subscriptions} = makeLnd({subscribes: args.subscribes});
  const got = [];

  const service = method({lnd, delay: 1});

  const [subscription] = subscriptions;

  service.end(() => got.push('ended'));
  service.message({type: '64'}, msg => got.push(msg.value));

  // The error listener can stop the service when it is told of the failure
  service.error(err => {
    got.push({err});

    return !args.is_stopping_on_error ? undefined : service.stop({});
  });

  // The stream fails, and can send more than one event when it does
  args.events.forEach(([event, data]) => subscription.emit(event, data));

  // The service can be stopped while waiting to subscribe again
  if (!!args.is_stopping) {
    service.stop({});
  }

  await wait();

  // Messages arrive on the newest stream
  const [current] = subscriptions.slice(-1);

  (args.received || []).forEach(n => current.emit('data', makeReceived(n)));

  await wait();

  const receivers = service.receivers();

  service.stop({});

  return {got, receivers, subscriptions: subscriptions.length};
};

// Service requests of type 0 and give the service messages
const serveRequests = async ({is_stopping, received, records}) => {
  const {lnd, sent, subscriptions} = makeLnd({});
  const got = [];

  const service = serviceNetworkRequests({lnd});

  const [subscription] = subscriptions;

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
      events: [['error', unavailable]],
      received: [{type: '64', value: '00'}],
    },
    description: 'A stream that fails is subscribed to again after the delay',
    expected: {got: [{err: failed}, '00'], receivers: 1, subscriptions: 2},
    method: resubscribe,
  },
  {
    args: {events: [['end']], received: [{type: '64', value: '00'}]},
    description: 'A stream that ends is subscribed to again after the delay',
    expected: {
      got: [{err: [503, 'NetworkMessagesSubscriptionEnded']}, '00'],
      receivers: 1,
      subscriptions: 2,
    },
    method: resubscribe,
  },
  {
    args: {events: [['error', unavailable], ['end']]},
    description: 'A stream that fails and ends is subscribed to again once',
    expected: {got: [{err: failed}], receivers: 1, subscriptions: 2},
    method: resubscribe,
  },
  {
    args: {events: [['error', unsupported]]},
    description: 'The service ends when LND does not have onion messages',
    expected: {
      got: [{err: [501, 'SubscribeOnionMessagesMethodUnsupported']}, 'ended'],
      receivers: 0,
      subscriptions: 1,
    },
    method: resubscribe,
  },
  {
    args: {events: [['error', denied]]},
    description: 'The service ends when LND denies the subscription',
    expected: {
      got: [
        {err: [403, 'PermissionDeniedToSubscribeToMessages', {err: denied}]},
        'ended',
      ],
      receivers: 0,
      subscriptions: 1,
    },
    method: resubscribe,
  },
  {
    args: {events: [['error', unverified]]},
    description: 'The service ends when LND denies the macaroon',
    expected: {
      got: [
        {
          err: [403, 'PermissionDeniedToSubscribeToMessages', {
            err: unverified,
          }],
        },
        'ended',
      ],
      receivers: 0,
      subscriptions: 1,
    },
    method: resubscribe,
  },
  {
    args: {events: [['error', unimplemented]]},
    description: 'The service ends when LND rejects the subscription',
    expected: {
      got: [
        {err: [503, 'SubscriptionToMessagesRejected', {err: unimplemented}]},
        'ended',
      ],
      receivers: 0,
      subscriptions: 1,
    },
    method: resubscribe,
  },
  {
    args: {events: [['error', unavailable]], is_stopping: true},
    description: 'A service stopped while waiting does not subscribe again',
    expected: {got: [{err: failed}], receivers: 0, subscriptions: 1},
    method: resubscribe,
  },
  {
    args: {events: [['error', unavailable]], is_stopping_on_error: true},
    description: 'A service stopped by its error listener does not subscribe',
    expected: {got: [{err: failed}], receivers: 0, subscriptions: 1},
    method: resubscribe,
  },
  {
    args: {events: [['error', unavailable]], subscribes: 1},
    description: 'The service ends when it cannot subscribe again',
    expected: {
      got: [
        {err: failed},
        {
          err: [503, 'FailedToSubscribeToNetworkMessages', {
            err: new Error('ChannelClosed'),
          }],
        },
        'ended',
      ],
      receivers: 0,
      subscriptions: 1,
    },
    method: resubscribe,
  },
  {
    args: {delay: 0, listen: () => {}, received: []},
    description: 'A delay is a number of milliseconds',
    error: 'ExpectedDelayMillisecondsToServiceNetworkMessages',
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
