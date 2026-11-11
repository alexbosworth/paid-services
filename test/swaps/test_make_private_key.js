const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {isPrivate} = require('tiny-secp256k1');

const makePrivateKey = require('./../../swaps/make_private_key');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');

// Make a private key, and say how long it is and if it is in range
const makeKey = args => {
  const key = makePrivateKey(args).private_key;

  return {is_in_range: isPrivate(hexAsBuffer(key)), length: key.length};
};

// Make two private keys, and say if they are different
const makeKeys = args => {
  const [a, b] = [args, args].map(n => makePrivateKey(n).private_key);

  return {is_different: a !== b};
};

const tests = [
  {
    args: {},
    description: 'A private key is made',
    expected: {is_in_range: true, length: 64},
    method: makeKey,
  },
  {
    args: {},
    description: 'Private keys are random',
    expected: {is_different: true},
    method: makeKeys,
  },
];

tests.forEach(({args, description, expected, method}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
