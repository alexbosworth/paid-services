const {createDecipheriv} = require('crypto');

const asyncAuto = require('async/auto');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getIdentity} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const algorithm = 'aes-256-gcm';
const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const iv = Buffer.alloc(16, 0);

/** Decrypt a trade with a secret preimage

  {
    auth: <Auth Tag Hex String>
    from: <Trading With Node Id Public Key Hex String>
    lnd: <Authenticated LND API Object>
    payload: <Encrypted Data Hex String>
    secret: <Preimage Hex String>
  }

  @returns via cbk or Promise
  {
    plain: <Plain Decrypted Secret Hex String>
  }
*/
module.exports = ({auth, from, lnd, payload, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!auth) {
          return cbk([400, 'ExpectedAuthToDecryptTradeSecret']);
        }

        if (!from) {
          return cbk([400, 'ExpectedFromTradingNodeIdToDecryptTradeSecret']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToDecryptTradeSecret']);
        }

        if (!payload) {
          return cbk([400, 'ExpectedTradePayloadToDecryptTradeSecret']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedTradeUnlockKeyToDecryptTradeSecret']);
        }

        return cbk();
      },

      // Get identity public key
      getId: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Compute a shared secret with the trading partner
      computeSharedSecret: ['validate', ({}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd,
          partner_public_key: from,
        },
        cbk);
      }],

      // Combine the shared secret with a payment preimage for the final secret
      key: ['computeSharedSecret', ({computeSharedSecret}, cbk) => {
        const paidSecret = hexAsBuffer(secret);
        const key = hexAsBuffer(computeSharedSecret.secret);

        // Combine the shared secret with the payment preimage
        for (let i = 0; i < key.length; ++i) {
          key[i] = key[i] ^ paidSecret[i];
        }

        return cbk(null, key);
      }],

      // Decrypt the payload
      decryptPayload: ['key', ({key}, cbk) => {
        const decipher = createDecipheriv(algorithm, key, iv);
        const encrypted = hexAsBuffer(payload);

        decipher.setAuthTag(hexAsBuffer(auth));

        // Try decrypting using the unlock key
        try {
          const elements = [decipher.update(encrypted), decipher.final()];

          return cbk(null, {plain: bufferAsHex(Buffer.concat(elements))});
        } catch (err) {
          return cbk([503, 'FailedToDecryptEncryptedTradePayload', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'decryptPayload'}, cbk));
  });
};
