const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const EventEmitter = require('node:events');
const {mock} = require('node:test');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const lnService = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {pointMultiply} = require('tiny-secp256k1');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultTimeoutMs = 1000 * 30;
const g = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const generator = Buffer.from(`02${g}`, 'hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const otherId = bufferAsHex(Buffer.alloc(32, 4));
const peer = `03${g}`;
const replyId = bufferAsHex(Buffer.alloc(32, 3));
const secret = Buffer.alloc(32, 1);
const {sendMessage} = lnService;
const sentWithReplyId = () => ({reply: replyId});
const sha256 = n => createHash('sha256').update(n).digest();

// The node identity public key for a secret of 32 bytes of 0x01
const identity = bufferAsHex(Buffer.from(pointMultiply(generator, secret)));

const wait = () => new Promise(resolve => setTimeout(resolve, 50));

// Reply path ids are random, so sent messages are given a known reply path id
lnService.sendMessage = args => sendMessage(args).then(sentWithReplyId);

const method = require('./../../network/request_network_reply');

// RPC uint64 map keys are eight little-endian bytes
const typeAsKey = type => {
  const bytes = Buffer.alloc(8);

  bytes.writeBigUInt64LE(BigInt(type));

  return bytes.toString('latin1');
};

// Make a fake LND with a connected peer and a stream of messages
const makeTestLnd = ({isUnsupported}) => {
  const lnd = makeLnd({});
  const sent = [];
  const subscription = new EventEmitter();

  subscription.cancel = () => {};

  const {getInfo} = lnd.default;

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, identity_pubkey: identity});
  });

  lnd.default.listPeers = ({}, cbk) => cbk(null, {
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

  return {lnd, sent, subscription};
};

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

// Request a reply, give the stream events, and get the result
const request = async ({events, isUnsupported, overrides}) => {
  const {lnd, subscription} = makeTestLnd({isUnsupported});

  // Failures are caught at once since they can come before the events
  const requesting = method(makeArgs({lnd, overrides})).catch(err => ({err}));

  await wait();

  events.forEach(([event, data]) => subscription.emit(event, data));

  return await requesting;
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
    args: {
      events: [['data', makeReceived({id: replyId, type: '66'})]],
      overrides: {introduction: peer.toUpperCase()},
    },
    description: 'A reply introduction key in uppercase is accepted',
    expected: {reply: {type: '66', value: '0102'}},
    method: request,
  },
  {
    args: {},
    description: 'A request without a timeout times out after 30 seconds',
    expected: {early: undefined, result: {err: [0, 'NetworkRequestTimeout']}},
    method: requestUntilTimeout,
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
  {
    args: {events: [], overrides: {introduction: hexAsBuffer(peer)}},
    description: 'A reply path introduction is a hex public key',
    expected: {err: [400, 'ExpectedReplyIntroductionToRequestNetworkReply']},
    method: request,
  },
];

tests.forEach(({args, description, expected, method}) => {
  test(description, async () => {
    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
