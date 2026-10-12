const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindHopRecords} = require('bolt04/blinding');
const {chanNumber} = require('bolt07');
const {decryptBlindedPath} = require('bolt04');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');
const {rawChanId} = require('bolt07');

const method = require('./../../network/get_path_outbound');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const bufferAsHex = buffer => buffer.toString('hex');
const compareKeys = (a, b) => Buffer.compare(hexAsBuffer(a), hexAsBuffer(b));
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const id = bufferAsHex(Buffer.alloc(32, 9));
const notFound = {details: 'edge not found'};
const numberOf = channel => chanNumber({channel}).number;
const outpoint = `${bufferAsHex(Buffer.alloc(32))}:0`;
const secretOf = n => Buffer.alloc(32, n);
const sha256 = n => createHash('sha256').update(n).digest();
const typeAllowedFeatures = '14';
const typeNextNodeId = '4';
const typePathId = '6';
const typeShortChannelId = '2';

// The node identity is the key of secret 1, its peer the key of secret 2
const identity = asKey(1);
const peer = asKey(2);
const other = asKey(3);

// The secrets of the nodes, to read the hops of a path as they would
const secrets = {
  [identity]: secretOf(1),
  [other]: secretOf(3),
  [peer]: secretOf(2),
};

// The channel of self with the peer, which has a private alias
const alias = '2x2x2';
const channel = '1x1x1';

// A channel that is not known
const unknown = '3x3x3';

// The direction of a node on the channel is 0 for the lesser key, else 1
const [lesser] = [identity, peer].sort(compareKeys);

const directionOf = key => key === lesser ? '0' : '1';

// The channel with the peer, as the graph has it
const graphChannel = {
  capacity: '1',
  chan_point: outpoint,
  channel_id: numberOf(channel),
  node1_pub: identity,
  node2_pub: peer,
};

// A channel in the graph that is not a channel of self
const otherChannel = {...graphChannel, node1_pub: other};

// The records of a hop that forwards to a next node
const toNode = next => [{type: typeNextNodeId, value: next}];

// The records of a hop that forwards over a channel
const over = scid => [{
  type: typeShortChannelId,
  value: rawChanId({channel: scid}).id,
}];

// The records of the final hop of the path, which has the path id
const ending = [{type: typePathId, value: id}];

// The records of a hop that forwards to the peer, with another record added
const toPeerWith = record => toNode(peer).concat(record);

// A hop of a node with its records
const hop = (publicKey, records) => ({records, public_key: publicKey});

// Make a blinded path through hops, which starts at the first hop
const makePath = hops => {
  const [first] = hops;

  const {key, path} = blindHopRecords({hops});

  return {key, hops: path, introduction_node: first.public_key};
};

// A path that starts at self and goes to the peer
const fromSelf = makePath([hop(identity, toNode(peer)), hop(peer, ending)]);

// Make a fake LND of the identity node, connected to the peer, with channels
// that are given, and that knows the graph channel when it is given
const makeTestLnd = ({channels, graph} = {}) => {
  const lnd = makeLnd({});

  const {getInfo, listChannels} = lnd.default;

  lnd.default.getChanInfo = ({}, cbk) => cbk(!graph ? notFound : null, graph);

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, identity_pubkey: identity});
  });

  lnd.default.listChannels = (args, cbk) => listChannels(args, (err, res) => {
    const [own] = res.channels;

    return cbk(err, {
      channels: (channels || []).map(n => ({
        ...own,
        alias_scids: n.alias_scids || [],
        chan_id: n.chan_id,
        remote_pubkey: n.remote_pubkey,
      })),
    });
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

  lnd.signer = {
    deriveSharedKey: ({ephemeral_pubkey}, cbk) => cbk(null, {
      shared_key: sha256(pointMultiply(ephemeral_pubkey, secretOf(1), true)),
    }),
  };

  return lnd;
};

// Get what to send over a path, and read the first hop to send with the key
// to send as the node the outbound hops end at would, since it gets the hops
const sendOver = async args => {
  const {hops, key, outbound} = await method(args);

  const [first] = hops;
  const [to] = outbound.slice(-1);

  const secret = sha256(pointMultiply(hexAsBuffer(key), secrets[to], true));

  const read = decryptBlindedPath({
    key,
    encrypted: first.encrypted_data,
    secret: bufferAsHex(secret),
  });

  return {outbound, hops: hops.length, id: read.id};
};

const tests = [
  {
    args: {path: fromSelf},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGetPathOutbound'],
  },
  {
    args: {lnd: makeTestLnd()},
    description: 'A blinded path is expected',
    error: [400, 'ExpectedBlindedPathToGetPathOutbound'],
  },
  {
    args: {lnd: makeTestLnd(), path: {...fromSelf, hops: []}},
    description: 'Blinded path hops are expected',
    error: [400, 'ExpectedBlindedPathHopsToGetPathOutbound'],
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: {...fromSelf, introduction_node: hexAsBuffer(identity)},
    },
    description: 'A path introduction node is a public key',
    error: [400, 'ExpectedIntroductionNodeKeyToGetPathOutbound'],
  },
  {
    args: {lnd: makeTestLnd(), path: {...fromSelf, key: undefined}},
    description: 'A blinded path key is expected',
    error: [400, 'ExpectedBlindedPathKeyToGetPathOutbound'],
  },
  {
    args: {lnd: makeTestLnd(), path: {...fromSelf, introduction_node: null}},
    description: 'A path introduction is expected',
    error: [400, 'ExpectedPathIntroductionToDeterminePathIntroduction'],
  },
  {
    args: {lnd: makeTestLnd(), path: makePath([hop(peer, ending)])},
    description: 'A path that starts at a peer is sent over as it is',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd({graph: graphChannel}),
      path: {
        ...makePath([hop(peer, ending)]),
        introduction_edge: `${channel}x${directionOf(peer)}`,
        introduction_node: undefined,
      },
    },
    description: 'A path that starts at an edge starts at its direction node',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {lnd: makeTestLnd(), path: fromSelf},
    description: 'A path that starts at self is sent to the next node named',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd({
        channels: [{chan_id: numberOf(channel), remote_pubkey: peer}],
      }),
      path: makePath([hop(identity, over(channel)), hop(peer, ending)]),
    },
    description: 'A path that starts at self over a channel goes to its peer',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd({
        channels: [{
          alias_scids: [numberOf(alias)],
          chan_id: numberOf(channel),
          remote_pubkey: peer,
        }],
      }),
      path: makePath([hop(identity, over(alias)), hop(peer, ending)]),
    },
    description: 'A private channel of self can be named by its alias',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd({graph: graphChannel}),
      path: makePath([hop(identity, over(channel)), hop(peer, ending)]),
    },
    description: 'A channel that self does not list is found in the graph',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toNode(identity)),
        hop(identity, toNode(peer)),
        hop(peer, ending),
      ]),
    },
    description: 'The hops of self are stepped past until another node',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd({graph: graphChannel}),
      path: {
        ...fromSelf,
        introduction_edge: `${channel}x${directionOf(identity)}`,
        introduction_node: undefined,
      },
    },
    description: 'A path that starts at an edge of self is sent to the next',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toPeerWith({type: '15', value: '00'})),
        hop(peer, ending),
      ]),
    },
    description: 'An unknown odd record in the hop of self is ignored',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toPeerWith({type: '16', value: '00'})),
        hop(peer, ending),
      ]),
    },
    description: 'An unknown even record in the hop of self is not followed',
    error: [400, 'UnexpectedUnknownRequiredRecordInOwnBlindedPathHop'],
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toPeerWith({type: typeAllowedFeatures, value: ''})),
        hop(peer, ending),
      ]),
    },
    description: 'A hop of self that allows no features is followed',
    expected: {id, hops: 1, outbound: [peer]},
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toPeerWith({type: typeAllowedFeatures, value: '01'})),
        hop(peer, ending),
      ]),
    },
    description: 'A hop of self that allows a feature is not followed',
    error: [400, 'UnsupportedFeatureInOwnBlindedPathHop'],
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toPeerWith({type: typePathId, value: id})),
        hop(peer, ending),
      ]),
    },
    description: 'A hop of self with a path id does not go on to a next node',
    error: [400, 'UnexpectedPathIdInOwnBlindedPathHop'],
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([
        hop(identity, toPeerWith({type: typePathId, value: ''})),
        hop(peer, ending),
      ]),
    },
    description: 'A hop of self with an empty path id does not go on either',
    error: [400, 'UnexpectedPathIdInOwnBlindedPathHop'],
  },
  {
    args: {lnd: makeTestLnd(), path: makePath([hop(identity, ending)])},
    description: 'A path that ends at self cannot be sent over',
    error: [400, 'UnexpectedBlindedPathToSelf'],
  },
  {
    args: {lnd: makeTestLnd(), path: makePath([hop(identity, toNode(peer))])},
    description: 'A path that goes on from self has hops after self',
    error: [400, 'ExpectedHopsAfterSelfInBlindedPath'],
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: makePath([hop(identity, over(unknown)), hop(peer, ending)]),
    },
    description: 'A next channel that is not found has no next node',
    error: [503, 'FailedToFindNextPeerInBlindedPath'],
  },
  {
    args: {
      lnd: makeTestLnd({graph: otherChannel}),
      path: makePath([hop(identity, over(channel)), hop(peer, ending)]),
    },
    description: 'A graph channel that self does not forward over is not used',
    error: [503, 'FailedToFindNextPeerInBlindedPath'],
  },
  {
    args: {
      lnd: makeTestLnd(),
      path: {
        ...makePath([hop(other, toNode(peer)), hop(peer, ending)]),
        introduction_node: identity,
      },
    },
    description: 'A hop of self that cannot be decrypted is an error',
    error: [503, 'FailedToDecryptOwnBlindedPathHop'],
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), error, 'Got error');
    }

    deepStrictEqual(await sendOver(args), expected, 'Got expected result');
  });
});
