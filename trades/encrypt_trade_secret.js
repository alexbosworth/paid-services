const {createCipheriv} = require('crypto');
const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {diffieHellmanComputeSecret} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const algorithm = 'aes-256-gcm';
const bufferAsHex = buffer => buffer.toString('hex');
const digest = 'sha512';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const iv = Buffer.alloc(16, 0);
const makePreimage = () => randomBytes(32).toString('hex');
const sha256 = n => createHash('sha256').update(n).digest();

/** Encode a secret for a trade

  {
    lnd: <Authenticated LND API Object>
    secret: <Secret Hex String>
    to: <Trading With Node Id Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    payment_secret: <Payment Hash Preimage Hex String>
    trade_auth_tag: <Trade Data Data Auth Tag Hex String>
    trade_cipher: <Trade Data Encrypted Hex String>
  }
*/
module.exports = ({lnd, secret, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToEncryptTradeSecret']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedSecretToTradeToEncryptTradeSecret']);
        }

        if (!to) {
          return cbk([400, 'ExpectedToPublicKeyToEncryptTradeSecret']);
        }

        return cbk();
      },

      // Generate a secret to use for the payment preimage
      paymentSecret: ['validate', ({}, cbk) => cbk(null, makePreimage())],

      // Compute a shared secret with the destination
      computeSharedSecret: ['validate', ({}, cbk) => {
        return diffieHellmanComputeSecret({lnd, partner_public_key: to}, cbk);
      }],

      // Combine the shared secret with a payment preimage for the final secret
      key: [
        'computeSharedSecret',
        'paymentSecret',
        ({computeSharedSecret, paymentSecret}, cbk) =>
      {
        const paidSecret = hexAsBuffer(paymentSecret);
        const key = hexAsBuffer(computeSharedSecret.secret);

        // Combine the shared secret with the payment preimage
        for (let i = 0; i < paidSecret.length; ++i) {
          key[i] = key[i] ^ paidSecret[i];
        }

        return cbk(null, key);
      }],

      // Encrypt the trade details with the secret
      encrypt: ['key', 'paymentSecret', ({key, paymentSecret}, cbk) => {
        try {
          createCipheriv(algorithm, key, iv);
        } catch (err) {
          return cbk([500, 'FailedToCreateCipherEncryptingSecret', {err}]);
        }

        const cipher = createCipheriv(algorithm, key, iv);

        const updated = [cipher.update(hexAsBuffer(secret)), cipher.final()];

        return cbk(null, {
          payment_secret: paymentSecret,
          trade_auth_tag: bufferAsHex(cipher.getAuthTag()),
          trade_cipher: bufferAsHex(Buffer.concat(updated)),
        });
      }],
    },
    returnResult({reject, resolve, of: 'encrypt'}, cbk));
  });
};
