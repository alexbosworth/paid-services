const asyncAuto = require('async/auto');
const {decryptBlindedPath} = require('bolt04');
const {diffieHellmanComputeSecret} = require('ln-service');
const {returnResult} = require('asyncjs-util');

/** Get the path id of a received message from its encrypted recipient data

  {
    encrypted: <Encrypted Recipient Data Hex String>
    key: <Path Key Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    [id]: <Path Identifier Hex String>
  }
*/
module.exports = ({encrypted, key, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!encrypted) {
          return cbk([400, 'ExpectedEncryptedRecipientDataToGetPathId']);
        }

        if (!key) {
          return cbk([400, 'ExpectedPathKeyToGetPathId']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetPathId']);
        }

        return cbk();
      },

      // Compute the shared secret of the path key and the node identity key
      getSecret: ['validate', ({}, cbk) => {
        return diffieHellmanComputeSecret({lnd, partner_public_key: key}, cbk);
      }],

      // Decrypt the recipient data to get the path id
      decrypt: ['getSecret', ({getSecret}, cbk) => {
        try {
          const {id} = decryptBlindedPath({
            encrypted,
            key,
            secret: getSecret.secret,
          });

          return cbk(null, {id});
        } catch (err) {
          return cbk([503, 'FailedToDecryptRecipientDataForPathId', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'decrypt'}, cbk));
  });
};
