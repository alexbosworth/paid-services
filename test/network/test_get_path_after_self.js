const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {decryptBlindedPath} = require('bolt04');
const {makeLnd} = require('mock-lnd');
const {pointMultiply} = require('tiny-secp256k1');

const method = require('./../../network/get_path_after_self');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const id = '09'.repeat(32);
const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const {keys} = Object;
const peer = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const secretOf = n => Buffer.alloc(32, n);
const sha256 = n => createHash('sha256').update(n).digest();

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  // A path that starts at self, the node of secret 1, and ends at the peer
  const path = blindedPathFromHops({id, hops: [identity, peer]});

  const args = {
    identity,
    hops: path.path,
    key: path.key,
    lnd: makeLnd({secret: '01'.repeat(32)}),
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Get the path after self and read its first hop as the next node would
const pathAfterSelf = async args => {
  const res = await method(args);

  const {hops, key} = res;

  const [first] = hops;

  const secret = sha256(pointMultiply(hexAsBuffer(key), secretOf(2), true));

  const read = decryptBlindedPath({
    key,
    encrypted: first.encrypted_data,
    secret: bufferAsHex(secret),
  });

  return {
    hops: hops.length,
    id: read.id,
    introduction_node: res.introduction_node,
  };
};

const tests = [
  {
    args: makeArgs({hops: []}),
    description: 'Blinded path hops are expected',
    error: [400, 'ExpectedBlindedPathHopsToGetPathAfterSelf'],
  },
  {
    args: makeArgs({identity: hexAsBuffer(identity)}),
    description: 'The identity public key is expected',
    error: [400, 'ExpectedIdentityPublicKeyToGetPathAfterSelf'],
  },
  {
    args: makeArgs({key: undefined}),
    description: 'A path key is expected',
    error: [400, 'ExpectedPathKeyToGetPathAfterSelf'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGetPathAfterSelf'],
  },
  {
    args: makeArgs({}),
    description: 'The path after self starts at the next node',
    expected: {id, hops: 1, introduction_node: peer},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), error, 'Got error');
    }

    deepStrictEqual(await pathAfterSelf(args), expected, 'Got expected');
  });
});
