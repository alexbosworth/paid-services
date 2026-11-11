const {deepStrictEqual} = require('node:assert/strict');
const {mock} = require('node:test');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const lnService = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {makeOnionMessage} = require('mock-lnd');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultTimeoutMs = 1000 * 30;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const {keys} = Object;
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const now = () => Date.now();
const other = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const otherId = '04'.repeat(32);
const partner = '0362c0a046dacce86ddd0343c6d3c7c79c2208ba0d9c9cf24a6d046d21d21f90f7';
const peer = '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const recipient = '02531fe6068134503d2723133227c867ac8fa6c83c537e9a44c3c5bdbdcb1fe337';
const relay = '03462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b';
const replyId = '03'.repeat(32);
const secret = '01'.repeat(32);
const {sendMessage} = lnService;
const sentWithReplyId = () => ({reply: '03'.repeat(32)});
const waitLimitMs = 1000 * 5;

// Reply path ids are random, so sent messages are given a known reply path id,
// and the reply path of a sent message is kept to check its hops
lnService.sendMessage = args => {
  args.lnd.replies.push(args.reply);

  return sendMessage(args).then(sentWithReplyId);
};

const method = require('./../../network/request_network_reply');

// The messages that a fake LND sent
const sentBy = lnd => lnd.calls
  .filter(n => n.method === 'sendOnionMessage')
  .map(n => n.args);

// The stream of messages that a fake LND gave to listen for replies
const subscriptionOf = lnd => lnd.calls
  .filter(n => n.method === 'subscribeOnionMessages')
  .map(n => n.subscription)
  .pop();

// Make a fake LND with connected peers and a channel with the partner peer,
// which can take messages only over channels, or not take messages at all,
// and that has routes back to self through relays. Every node relays.
const makeTestLnd = ({isChannelsOnly, isUnsupported, routes}) => {
  const lnd = makeLnd({
    channels: [{partner_public_key: partner}],
    features: !isChannelsOnly ? [] : [66],
    graph: {
      nodes: [other, partner, peer, recipient, relay].map(key => ({
        features: [39],
        public_key: key,
      })),
    },
    peers: [{public_key: peer}, {public_key: partner}],
    routes: routes || [],
    secret,
  });

  // LND without onion messages has no method to subscribe to them
  if (!!isUnsupported) {
    delete lnd.default.subscribeOnionMessages;
  }

  // The reply paths of the messages that are sent
  lnd.replies = [];

  return lnd;
};

// A route found from a node back to self, that a message to the node goes
// back along through the relays, which are given in order from self
const routeThrough = relays => ({
  hops: [].concat(relays).reverse().concat(identity).map(key => {
    return {public_key: key};
  }),
});

// Make an onion message received over a blinded path to self
const makeReceived = ({id, type}) => {
  const path = blindedPathFromHops({id, hops: [identity]});

  const [hop] = path.path;

  return makeOnionMessage({
    encrypted: hop.encrypted_data,
    key: path.key,
    message: {type, value: '0102'},
    via: peer,
  });
};

// Make a message of a reply type with data that does not decrypt to a path id
const unreadable = () => makeOnionMessage({
  encrypted: '07'.repeat(40),
  key: peer,
  message: {type: '66', value: '00'},
  via: peer,
});

// Make arguments to request a reply
const makeArgs = ({lnd, overrides}) => {
  const path = blindedPathFromHops({hops: [peer]});

  const args = {
    lnd,
    message: {type: '64', value: '00'},
    path: {hops: path.path, introduction_node: peer, key: path.key},
    types: ['66'],
  };

  keys(overrides || {}).forEach(k => args[k] = overrides[k]);

  return args;
};

// Wait for the request to be sent, which is when it listens for a reply, or
// for it to finish before it is sent. A request that does neither is given
// up on after a limit, so that its test fails instead of hanging.
const untilSent = async ({lnd, requesting}) => {
  const limit = now() + waitLimitMs;

  let isFinished = false;

  requesting.then(() => isFinished = true, () => isFinished = true);

  while (!sentBy(lnd).length && !isFinished && now() < limit) {
    await nextTick();
  }
};

// Request a reply, give the stream events, and get the result
const request = async ({events, isUnsupported, overrides}) => {
  const lnd = makeTestLnd({isUnsupported});

  // Failures are caught at once since they can come before the events
  const requesting = method(makeArgs({lnd, overrides})).catch(err => ({err}));

  await untilSent({lnd, requesting});

  events.forEach(([type, data]) => subscriptionOf(lnd).emit(type, data));

  return await requesting;
};

// Request a reply over a path through hops, with the introduction node
// reached through relays when it is not a peer, and get the reply path hops
// and the peer that the request was sent to
const replyHops = async ({hops, isChannelsOnly, maxHops, relays}) => {
  const lnd = makeTestLnd({
    isChannelsOnly,
    routes: !relays ? [] : [routeThrough(relays)],
  });

  const [introduction] = hops;

  const path = blindedPathFromHops({hops});

  const requesting = method(makeArgs({
    lnd,
    overrides: {
      max_reply_hops: maxHops,
      path: {hops: path.path, introduction_node: introduction, key: path.key},
    },
  }));

  await untilSent({lnd, requesting});

  subscriptionOf(lnd).emit('data', makeReceived({id: replyId, type: '66'}));

  await requesting;

  const [reply] = lnd.replies;
  const [request] = sentBy(lnd);

  return {reply, to: bufferAsHex(request.peer)};
};

// Request a reply that never comes and check the default timeout
const requestUntilTimeout = async ({}) => {
  const lnd = makeTestLnd({});

  mock.timers.enable({apis: ['setTimeout']});

  try {
    const requesting = method(makeArgs({lnd})).catch(err => ({err}));

    // Wait for the request to be sent, which starts the wait for the reply
    while (!sentBy(lnd).length) {
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
    args: {events: [['data', unreadable()], ['end']]},
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
    description: 'A reply path starts at an introduction node that is a peer',
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
