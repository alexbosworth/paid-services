const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {makeLnd} = require('mock-lnd');
const {makeOnionMessage} = require('mock-lnd');

const encodePeerRequest = require('./../../p2p/encode_peer_request');
const method = require('./../../network/service_network_messages');
const {serviceNetworkRequests} = require('./../../network');

const bufferAsHex = buffer => buffer.toString('hex');
const denied = {code: 7, details: 'permission denied'};
const id = '01'.repeat(32);
const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const largeOnionBytes = 32834;
const lengthsOf = lists => lists.map(([list]) => list().length).join(',');
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const now = () => Date.now();
const peer = '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const requestId = '02'.repeat(32);
const secret = '01'.repeat(32);
const unavailable = {code: 14, details: 'read ECONNRESET'};
const unimplemented = {code: 12, details: 'unknown service'};
const unsupported = {details: 'unknown method SubscribeOnionMessages'};
const unverified = {code: 2, details: 'verification failed: bad signature'};
const wait = () => new Promise(resolve => setTimeout(resolve, 50));
const waitLimitMs = 1000 * 5;

// The error reported when the stream fails with an unavailable LND
const failed = [503, 'NetworkMessagesSubscriptionFailed', {err: unavailable}];

// Wait for the service to finish what the test expects of it: for its
// callbacks and events to fill the lists to the lengths expected, turn by turn
// of the event loop, and then for the turns that add anything more to end. A
// service that never finishes is given up on after a limit, so that its test
// fails instead of hanging.
const untilFinished = async lists => {
  const isFilling = () => lists.some(([list, size]) => {
    return list().length < size;
  });
  const limit = now() + waitLimitMs;

  while (isFilling() && now() < limit) {
    await nextTick();
  }

  let lengths;

  do {
    lengths = lengthsOf(lists);

    await nextTick();
  } while (lengthsOf(lists) !== lengths);
};

// The messages that a fake LND sent
const sentBy = lnd => lnd.calls
  .filter(n => n.method === 'sendOnionMessage')
  .map(n => n.args);

// The streams of messages that a fake LND gave
const subscriptionsOf = lnd => lnd.calls
  .filter(n => n.method === 'subscribeOnionMessages')
  .map(n => n.subscription);

// Make a fake LND connected to the peer, that can fail getting peers a number
// of times, and that can stop giving streams after a number of streams
const makeTestLnd = ({failPeers, subscribes}) => {
  const lnd = makeLnd({secret, peers: [{public_key: peer}]});

  const {deriveSharedKey} = lnd.signer;
  const {listPeers, subscribeOnionMessages} = lnd.default;

  // Getting peers can fail a number of times before it works
  let failures = failPeers || Number();

  lnd.default.listPeers = (args, cbk) => {
    return failures-- > 0 ? cbk('err') : listPeers(args, cbk);
  };

  // Each subscription to messages is a new stream, while there are more
  lnd.default.subscribeOnionMessages = args => {
    if (subscriptionsOf(lnd).length === subscribes) {
      throw new Error('ChannelClosed');
    }

    return subscribeOnionMessages(args);
  };

  // Shared keys are derived after a moment, like over the network
  lnd.signer.deriveSharedKey = (args, cbk) => {
    return setImmediate(() => deriveSharedKey(args, cbk));
  };

  return lnd;
};

// Make an onion message received on a path to self
const makeReceived = ({isLarge, type, value, withReply}) => {
  const path = blindedPathFromHops({id, hops: [identity]});
  const reply = blindedPathFromHops({hops: [peer]});

  const [hop] = path.path;

  const replyPath = {
    inbound: reply.path,
    introduction_node: peer,
    key: reply.key,
  };

  return makeOnionMessage({
    encrypted: hop.encrypted_data,
    key: path.key,
    message: {type, value},
    onion: !isLarge ? undefined : '00'.repeat(largeOnionBytes),
    reply: !withReply ? undefined : replyPath,
    via: peer,
  });
};

// Summarize the onion messages that were sent
const summary = sent => sent.map(n => ({
  peer: bufferAsHex(n.peer),
  size: n.onion.length,
}));

// Service messages of type 64 with a listener and give the service messages,
// waiting for what the test expects of the service
const serve = async (args, expected) => {
  const got = [];
  const lnd = makeTestLnd({failPeers: args.fail_peers});

  const service = method({lnd, delay: args.delay, ids: args.ids});

  const [subscription] = subscriptionsOf(lnd);

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

  await untilFinished([
    [() => got, expected.got.length],
    [() => sentBy(lnd), expected.sent.length],
  ]);

  service.stop({});

  return {got, sent: summary(sentBy(lnd))};
};

// Service messages, fail the stream with events, and see if the stream is
// subscribed to again after the delay, with messages on the new stream
// reaching the listener, waiting for what the test expects of the service
const resubscribe = async (args, expected) => {
  const got = [];
  const lnd = makeTestLnd({subscribes: args.subscribes});

  const service = method({lnd, delay: 1});

  const [subscription] = subscriptionsOf(lnd);

  service.end(() => got.push('ended'));
  service.message({type: '64'}, msg => got.push(msg.value));

  // The error listener can stop the service when it is told of the failure
  service.error(err => {
    got.push({err});

    return !args.is_stopping_on_error ? undefined : service.stop({});
  });

  // The stream fails, and can send more than one event when it does
  args.events.forEach(([type, data]) => subscription.emit(type, data));

  // The service can be stopped while waiting to subscribe again
  if (!!args.is_stopping) {
    service.stop({});
  }

  // The delay to subscribe again is a timer, which goes off before a longer
  // wait does, whether or not the service is slowed down
  await wait();

  // Messages arrive on the newest stream
  const [current] = subscriptionsOf(lnd).slice(-1);

  (args.received || []).forEach(n => current.emit('data', makeReceived(n)));

  await untilFinished([[() => got, expected.got.length]]);

  const receivers = service.receivers();

  service.stop({});

  return {got, receivers, subscriptions: subscriptionsOf(lnd).length};
};

// Service requests of type 0 and give the service messages, waiting for what
// the test expects of the service
const serveRequests = async (args, expected) => {
  const got = [];
  const lnd = makeTestLnd({});

  const service = serviceNetworkRequests({lnd});

  const [subscription] = subscriptionsOf(lnd);

  service.error(err => got.push({err}));

  // The service can be stopped while a response is being sent
  service.request({type: '0'}, (req, res) => {
    got.push(req);

    res.success({records: args.records || [{type: '1', value: '01'}]});

    return !args.is_stopping ? undefined : service.stop({});
  });

  args.received.forEach(n => subscription.emit('data', makeReceived(n)));

  await untilFinished([
    [() => got, expected.got.length],
    [() => sentBy(lnd), expected.sent.length],
  ]);

  service.stop({});

  return {got, sent: summary(sentBy(lnd))};
};

// Reply with replies that fit, that do not fit, and that have no limit
const replyOfEachSize = (msg, responder, push) => {
  const {reply} = responder;

  return responder.reply_bytes({type: '66'}, (err, res) => {
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

    const got = await method(args, expected);

    deepStrictEqual(got, expected, 'Got expected result');
  });
});
