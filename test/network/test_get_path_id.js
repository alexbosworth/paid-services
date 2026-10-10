const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {pointMultiply} = require('tiny-secp256k1');

const method = require('./../../network/get_path_id');

const bufferAsHex = buffer => buffer.toString('hex');
const g = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const generator = Buffer.from(`02${g}`, 'hex');
const id = bufferAsHex(Buffer.alloc(32, 1));
const secret = Buffer.alloc(32, 1);
const sha256 = n => createHash('sha256').update(n).digest();

// The node identity public key for a secret of 32 bytes of 0x01
const identity = bufferAsHex(Buffer.from(pointMultiply(generator, secret)));

// LND derives a shared key as the hash of the compressed shared point
const lnd = {
  signer: {
    deriveSharedKey: ({ephemeral_pubkey}, cbk) => cbk(null, {
      shared_key: sha256(pointMultiply(ephemeral_pubkey, secret, true)),
    }),
  },
};

const blinded = blindedPathFromHops({id, hops: [identity]});
const [hop] = blinded.path;

const makeArgs = overrides => {
  const args = {encrypted: hop.encrypted_data, key: blinded.key, lnd};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({encrypted: undefined}),
    description: 'Encrypted data is expected',
    error: [400, 'ExpectedEncryptedRecipientDataToGetPathId'],
  },
  {
    args: makeArgs({key: undefined}),
    description: 'A path key is expected',
    error: [400, 'ExpectedPathKeyToGetPathId'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGetPathId'],
  },
  {
    args: makeArgs({key: `02${g}`}),
    description: 'Data that does not decrypt is an error',
    error: [503, 'FailedToDecryptRecipientDataForPathId'],
  },
  {
    args: makeArgs({}),
    description: 'The path id is decrypted',
    expected: {id},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), error, 'Got error');
    }

    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
