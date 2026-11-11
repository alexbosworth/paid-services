const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {makeLnd} = require('mock-lnd');

const method = require('./../../network/get_path_id');

const generator = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const id = '01'.repeat(32);
const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const {keys} = Object;
const secret = '01'.repeat(32);

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  // The path is to the node of the secret, whose fake LND derives its keys
  const blinded = blindedPathFromHops({id, hops: [identity]});

  const [hop] = blinded.path;

  const args = {
    encrypted: hop.encrypted_data,
    key: blinded.key,
    lnd: makeLnd({secret}),
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

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
    args: makeArgs({key: generator}),
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
