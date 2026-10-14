const {strictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {isPrivate} = require('tiny-secp256k1');

const method = require('./../../swaps/make_private_key');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');

test('A private key is made', () => {
  const {private_key} = method({});

  strictEqual(private_key.length, 64, 'Got a 32 byte private key');
  strictEqual(isPrivate(hexAsBuffer(private_key)), true, 'Key is in range');
});

test('Private keys are random', () => {
  strictEqual(method({}).private_key !== method({}).private_key, true);
});
