const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {makeLnd} = require('mock-lnd');

const method = require('./../../network/create_network_path');

const bufferAsHex = buffer => buffer.toString('hex');
const g = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const id = bufferAsHex(Buffer.alloc(32, 1));
const peer = `03${g}`;
const identity = `02${g}`;

const makeTestLnd = ({peers}) => {
  const lnd = makeLnd({});

  const {getInfo} = lnd.default;

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, identity_pubkey: identity});
  });

  lnd.default.listPeers = ({}, cbk) => cbk(null, {
    peers: peers.map(key => ({
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

  return lnd;
};

const makeArgs = overrides => {
  const args = {lnd: makeTestLnd({peers: [peer]})};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Create a path and describe it, since its keys are random
const create = async args => {
  const res = await method(args);

  return {
    hops: res.path.hops.length,
    id: res.id,
    introduction_node: res.path.introduction_node,
    key_bytes: res.path.key.length / 2,
  };
};

const tests = [
  {
    args: makeArgs({id: 'id'}),
    description: 'A hex path id is expected',
    error: [400, 'ExpectedHexEncodedPathIdToCreateNetworkPath'],
  },
  {
    args: makeArgs({id: '01'.repeat(15)}),
    description: 'A path id is at least 16 bytes',
    error: [400, 'ExpectedLongerPathIdToCreateNetworkPath'],
  },
  {
    args: makeArgs({introduction: 'introduction'}),
    description: 'An introduction public key is expected',
    error: [400, 'ExpectedIntroductionPublicKeyToCreateNetworkPath'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToCreateNetworkPath'],
  },
  {
    args: makeArgs({introduction: identity}),
    description: 'The introduction is expected to be a peer and not self',
    error: [400, 'ExpectedIntroductionPeerOtherThanSelfForPath'],
  },
  {
    args: makeArgs({introduction: peer, lnd: makeTestLnd({peers: []})}),
    description: 'The introduction is expected to be a connected peer',
    error: [503, 'ExpectedConnectedIntroductionPeerToCreatePath'],
  },
  {
    args: makeArgs({id}),
    description: 'A path to self is created',
    expected: {id, hops: 1, introduction_node: identity, key_bytes: 33},
  },
  {
    args: makeArgs({id, introduction: peer}),
    description: 'A path through an introduction peer is created',
    expected: {id, hops: 2, introduction_node: peer, key_bytes: 33},
  },
  {
    args: makeArgs({id, introduction: peer.toUpperCase()}),
    description: 'An introduction peer key in uppercase is the same peer',
    expected: {id, hops: 2, introduction_node: peer, key_bytes: 33},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(create(args), error, 'Got error');
    }

    deepStrictEqual(await create(args), expected, 'Got expected result');
  });
});
