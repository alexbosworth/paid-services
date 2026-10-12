const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {decryptBlindedPath} = require('bolt04');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');

const method = require('./../../network/get_path_after_self');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const id = bufferAsHex(Buffer.alloc(32, 9));
const secretOf = n => Buffer.alloc(32, n);
const sha256 = n => createHash('sha256').update(n).digest();

// The node identity is the key of secret 1, its peer the key of secret 2
const identity = asKey(1);
const peer = asKey(2);

// A fake LND of the identity node, which derives shared keys with its key
const lnd = {
  signer: {
    deriveSharedKey: ({ephemeral_pubkey}, cbk) => cbk(null, {
      shared_key: sha256(pointMultiply(ephemeral_pubkey, secretOf(1), true)),
    }),
  },
};

// A path that starts at self and ends at the peer
const path = blindedPathFromHops({id, hops: [identity, peer]});

const makeArgs = overrides => {
  const args = {identity, lnd, hops: path.path, key: path.key};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Get the path after self and read its first hop as the next node would
const pathAfterSelf = async args => {
  const {hops, introduction_node, key} = await method(args);

  const [first] = hops;

  const secret = sha256(pointMultiply(hexAsBuffer(key), secretOf(2), true));

  const read = decryptBlindedPath({
    key,
    encrypted: first.encrypted_data,
    secret: bufferAsHex(secret),
  });

  return {introduction_node, hops: hops.length, id: read.id};
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
