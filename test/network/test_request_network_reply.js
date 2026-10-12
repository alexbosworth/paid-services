const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const EventEmitter = require('node:events');
const {mock} = require('node:test');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const lnService = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');

const bufferAsHex = buffer => buffer.toString('hex');
const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const defaultTimeoutMs = 1000 * 30;
const g = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const generator = Buffer.from(`02${g}`, 'hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const now = () => Date.now();
const otherId = bufferAsHex(Buffer.alloc(32, 4));
const peer = `03${g}`;
const replyId = bufferAsHex(Buffer.alloc(32, 3));
const secret = Buffer.alloc(32, 1);
const {sendMessage} = lnService;
const sentWithReplyId = () => ({reply: replyId});
const sha256 = n => createHash('sha256').update(n).digest();
const waitLimitMs = 1000 * 5;

// The node identity public key for a secret of 32 bytes of 0x01
const identity = bufferAsHex(Buffer.from(pointMultiply(generator, secret)));

// Nodes that are not connected peers, reached over a route through relays
const other = asKey(2);
const recipient = asKey(3);
const relay = asKey(4);

// A connected peer that has a channel with self
const partner = asKey(5);

// Reply path ids are random, so sent messages are given a known reply path id,
// and the reply path of a sent message is kept to check its hops
lnService.sendMessage = args => {
  args.lnd.replies.push(args.reply);

  return sendMessage(args).then(sentWithReplyId);
};

// Routes to nodes that are not peers are faked, so that nothing is looked up,
// and every node that is looked up relays onion messages
const fakes = {routes: []};

lnService.getNode = ({}, cbk) => cbk(null, {features: [{bit: 39}]});

lnService.getRouteToDestination = ({}, cbk) => {
  return cbk(null, {route: fakes.routes.shift() || null});
};

const method = require('./../../network/request_network_reply');

// RPC uint64 map keys are eight little-endian bytes
const typeAsKey = type => {
  const bytes = Buffer.alloc(8);

  bytes.writeBigUInt64LE(BigInt(type));

  return bytes.toString('latin1');
};

// Make a fake LND with connected peers, a channel with the partner peer, and
// a stream of messages, which can take messages only over channels
const makeTestLnd = ({isChannelsOnly, isUnsupported}) => {
  const lnd = makeLnd({});
  const sent = [];
  const subscription = new EventEmitter();

  subscription.cancel = () => {};

  const {getInfo, listChannels} = lnd.default;

  // A node that only takes messages over channels signals feature bit 66 or 67
  const features = !isChannelsOnly ? {} : {
    '66': {is_known: true, is_required: false, name: 'only-channels'},
  };

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, features, identity_pubkey: identity});
  });

  lnd.default.listChannels = (args, cbk) => listChannels(args, (err, res) => {
    const [channel] = res.channels;

    return cbk(err, {channels: [{...channel, remote_pubkey: partner}]});
  });

  lnd.default.listPeers = ({}, cbk) => cbk(null, {
    peers: [peer, partner].map(key => ({
      address: '127.0.0.1:9735',
      bytes_recv: '0',
      bytes_sent: '0',
      errors: [],
      features: {},
      flap_count: 0,
      inbound: false,
      last_flap_ns: '0',
      ping_time: '0',
      pub_key: key,
      sat_recv: '0',
      sat_sent: '0',
      sync_type: 'ACTIVE_SYNC',
    })),
  });

  lnd.default.sendOnionMessage = (args, cbk) => {
    sent.push(args);

    return cbk();
  };

  // LND without onion messages has no method to subscribe to them
  if (!isUnsupported) {
    lnd.default.subscribeOnionMessages = () => subscription;
  }

  lnd.signer = {
    deriveSharedKey: ({ephemeral_pubkey}, cbk) => cbk(null, {
      shared_key: sha256(pointMultiply(ephemeral_pubkey, secret, true)),
    }),
  };

  // The reply paths of the messages that are sent
  lnd.replies = [];

  return {lnd, sent, subscription};
};

// A route found from a node back to self, that a message to the node goes
// back along through the relays, which are given in order from self
const routeThrough = relays => ({
  hops: [].concat(relays).reverse().concat(identity).map(key => {
    return {public_key: key};
  }),
});

// Make an RPC onion message received over a blinded path to self
const makeReceived = ({id, type}) => {
  const path = blindedPathFromHops({id, hops: [identity]});

  return {
    custom_records: {[typeAsKey(type)]: hexAsBuffer('0102')},
    encrypted_recipient_data: hexAsBuffer(path.path[0].encrypted_data),
    onion: Buffer.alloc(1366),
    path_key: hexAsBuffer(path.key),
    peer: hexAsBuffer(peer),
  };
};

// A message of a reply type with data that does not decrypt to a path id
const unreadable = {
  custom_records: {[typeAsKey('66')]: hexAsBuffer('00')},
  encrypted_recipient_data: Buffer.alloc(40, 7),
  onion: Buffer.alloc(1366),
  path_key: hexAsBuffer(peer),
  peer: hexAsBuffer(peer),
};

// Make arguments to request a reply
const makeArgs = ({lnd, overrides}) => {
  const path = blindedPathFromHops({hops: [peer]});

  const args = {
    lnd,
    message: {type: '64', value: '00'},
    path: {hops: path.path, introduction_node: peer, key: path.key},
    types: ['66'],
  };

  Object.keys(overrides || {}).forEach(k => args[k] = overrides[k]);

  return args;
};

// Wait for the request to be sent, which is when it listens for a reply, or
// for it to finish before it is sent. A request that does neither is given
// up on after a limit, so that its test fails instead of hanging.
const untilSent = async ({requesting, sent}) => {
  const limit = now() + waitLimitMs;

  let isFinished = false;

  requesting.then(() => isFinished = true, () => isFinished = true);

  while (!sent.length && !isFinished && now() < limit) {
    await nextTick();
  }
};

// Request a reply, give the stream events, and get the result
const request = async ({events, isUnsupported, overrides}) => {
  const {lnd, sent, subscription} = makeTestLnd({isUnsupported});

  // Failures are caught at once since they can come before the events
  const requesting = method(makeArgs({lnd, overrides})).catch(err => ({err}));

  await untilSent({requesting, sent});

  events.forEach(([event, data]) => subscription.emit(event, data));

  return await requesting;
};

// Request a reply over a path through hops, with the introduction node
// reached through relays when it is not a peer, and get the reply path hops
// and the peer that the request was sent to
const replyHops = async ({hops, isChannelsOnly, maxHops, relays}) => {
  const {lnd, sent, subscription} = makeTestLnd({isChannelsOnly});

  fakes.routes = !relays ? [] : [routeThrough(relays)];

  const [introduction] = hops;

  const path = blindedPathFromHops({hops});

  const requesting = method(makeArgs({
    lnd,
    overrides: {
      max_reply_hops: maxHops,
      path: {hops: path.path, introduction_node: introduction, key: path.key},
    },
  }));

  await untilSent({requesting, sent});

  subscription.emit('data', makeReceived({id: replyId, type: '66'}));

  await requesting;

  const [reply] = lnd.replies;
  const [request] = sent;

  return {reply, to: bufferAsHex(request.peer)};
};

// Request a reply that never comes and check the default timeout
const requestUntilTimeout = async ({}) => {
  const {lnd, sent} = makeTestLnd({});

  mock.timers.enable({apis: ['setTimeout']});

  try {
    const requesting = method(makeArgs({lnd})).catch(err => ({err}));

    // Wait for the request to be sent, which starts the wait for the reply
    while (!sent.length) {
      await nextTick();
    }

    let result;

    requesting.then(res => result = res);

    // Just before the default timeout the request is still waiting
    mock.timers.tick(defaultTimeoutMs - 1);

    await nextTick();

    const early = result;

    mock.timers.tick(1);

    return {early, result: await requesting};
  } finally {
    mock.timers.reset();
  }
};

const tests = [
  {
    args: {events: [['end']]},
    description: 'A request fails when the stream of messages ends',
    expected: {err: [503, 'NetworkReplyListenerEnded']},
    method: request,
  },
  {
    args: {events: [['data', unreadable], ['end']]},
    description: 'A message that cannot be read does not end the request',
    expected: {err: [503, 'NetworkReplyListenerEnded']},
    method: request,
  },
  {
    args: {events: [['data', makeReceived({id: replyId, type: '66'})]]},
    description: 'A reply on the reply path of the request is returned',
    expected: {reply: {type: '66', value: '0102'}},
    method: request,
  },
  {
    args: {
      events: [['data', makeReceived({id: otherId, type: '66'})]],
      overrides: {timeout: 200},
    },
    description: 'A reply on a different path is ignored',
    expected: {err: [0, 'NetworkRequestTimeout']},
    method: request,
  },
  {
    args: {
      events: [['data', makeReceived({id: replyId, type: '64'})]],
      overrides: {timeout: 200},
    },
    description: 'A message that is not of a reply type is ignored',
    expected: {err: [0, 'NetworkRequestTimeout']},
    method: request,
  },
  {
    args: {events: [], isUnsupported: true},
    description: 'LND without onion messages returns an error',
    expected: {
      err: [
        501,
        'ExpectedLndSupportingOnionMessagesToRequestNetworkReply',
        {err: new Error('ExpectedAuthenticatedLndToSubscribeToMessages')},
      ],
    },
    method: request,
  },
  {
    args: {hops: [peer, recipient]},
    description: 'The reply path starts at an introduction node that is a peer',
    expected: {reply: [peer, identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [other, recipient], relays: [peer, relay]},
    description: 'The reply path goes back through relays to the introduction',
    expected: {reply: [other, relay, peer, identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [peer]},
    description: 'The reply path to a recipient that is a peer is only self',
    expected: {reply: [identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [other], relays: [peer, relay]},
    description: 'The reply path to a relayed recipient starts at its relay',
    expected: {reply: [relay, peer, identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [peer, recipient], isChannelsOnly: true, relays: [partner]},
    description: 'The reply path ends over a channel when self needs one',
    expected: {reply: [peer, partner, identity], to: partner},
    method: replyHops,
  },
  {
    args: {hops: [other, recipient], maxHops: 3, relays: [peer, relay]},
    description: 'A reply path over the maximum keeps the hops nearest self',
    expected: {reply: [relay, peer, identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [other, recipient], maxHops: 4, relays: [peer, relay]},
    description: 'A reply path within the maximum is whole',
    expected: {reply: [other, relay, peer, identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [identity, peer]},
    description: 'A path that starts at self is sent to the next node',
    expected: {reply: [identity], to: peer},
    method: replyHops,
  },
  {
    args: {hops: [identity, peer, recipient]},
    description: 'A path that starts at self has its reply path from the next',
    expected: {reply: [peer, identity], to: peer},
    method: replyHops,
  },
  {
    args: {},
    description: 'A request without a timeout times out after 30 seconds',
    expected: {early: undefined, result: {err: [0, 'NetworkRequestTimeout']}},
    method: requestUntilTimeout,
  },
  {
    args: {events: [], overrides: {max_reply_hops: 0}},
    description: 'A maximum of reply hops is a positive number',
    expected: {err: [400, 'ExpectedMaximumReplyHopsToRequestNetworkReply']},
    method: request,
  },
  {
    args: {events: [], overrides: {timeout: 0}},
    description: 'A timeout is a positive number',
    expected: {err: [400, 'ExpectedPositiveTimeoutToRequestNetworkReply']},
    method: request,
  },
  {
    args: {events: [], overrides: {timeout: 1.5}},
    description: 'A timeout is a whole number',
    expected: {err: [400, 'ExpectedPositiveTimeoutToRequestNetworkReply']},
    method: request,
  },
  {
    args: {events: [], overrides: {timeout: '100'}},
    description: 'A timeout is a number',
    expected: {err: [400, 'ExpectedPositiveTimeoutToRequestNetworkReply']},
    method: request,
  },
  {
    args: {
      events: [],
      overrides: {
        path: {
          hops: [{encrypted_data: '00', relay_key: peer}],
          introduction_node: hexAsBuffer(peer),
          key: peer,
        },
      },
    },
    description: 'A path introduction node is a hex public key',
    expected: {err: [400, 'ExpectedIntroductionKeyToRequestNetworkReply']},
    method: request,
  },
  {
    args: {
      events: [],
      overrides: {
        path: {
          hops: [{encrypted_data: '00', relay_key: peer}],
          introduction_edge: 1,
          key: peer,
        },
      },
    },
    description: 'A path introduction edge is a string',
    expected: {err: [400, 'ExpectedIntroductionEdgeToRequestNetworkReply']},
    method: request,
  },
];

tests.forEach(({args, description, expected, method}) => {
  test(description, async () => {
    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
