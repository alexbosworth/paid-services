const {createHash} = require('crypto');
const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');

const encodeOffToOnRequest = require('./encode_off_to_on_request');

const bufferAsHex = buffer => buffer.toString('hex');
const family = 805;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const makeSecret = () => randomBytes(32);
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');

/** Initialize the claim details of a swap

  {
    [is_external_solo_key]: <Use External Unilateral Claim Key Bool>
    lnd: <Authenticated LND API Object>
    tokens: <Swap Tokens Number>
  }

  @returns via cbk or Promise
  {
    recovery: <Encoded Swap Recovery Details Hex String>
    request: <Encoded Swap Request Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import the ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToStartOffToOnSwap']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedTokensToSwapToStartOffToOnSwap']);
        }

        return cbk();
      },

      // Generate the claim secret and hash
      generateSecret: ['validate', ({}, cbk) => {
        const secret = makeSecret();

        const hash = sha256(secret);

        return cbk(null, {hash, secret: bufferAsHex(secret)});
      }],

      // Compute an encryption secret for encrypting private state data
      getEncrypt: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd: args.lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Get the identity public key to generate secrets encryption key to
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network name for creating the private key
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Bitcoinjs network details
      network: ['getNetwork', ({getNetwork}, cbk) => {
        const network = networks[getNetwork.bitcoinjs];

        if (!network) {
          return cbk([400, 'UnsupportedNetworkToStartOffToOnSwapOn']);
        }

        return cbk(null, network);
      }],

      // Generate the claim coop key
      generateCoopKey: ['ecp', 'network', ({ecp, network}, cbk) => {
        const {privateKey, publicKey} = ecp.makeRandom({network});

        return cbk(null, {
          hash: sha256(publicKey),
          key: bufferAsHex(privateKey),
        });
      }],

      // Generate the claim solo key
      generateSoloKey: ['ecp', 'network', ({ecp, network}, cbk) => {
        // Exit early when the solo key is derived from the internal seed
        if (!args.is_external_solo_key) {
          return cbk(null, {});
        }

        const {publicKey, privateKey} = ecp.makeRandom({network});

        return cbk(null, {
          pub: bufferAsHex(publicKey),
          key: bufferAsHex(privateKey),
        });
      }],

      // Get the claim unilateral key
      getClaimKey: ['generateSoloKey', ({generateSoloKey}, cbk) => {
        // Exit early when the solo key is generated
        if (!!generateSoloKey.pub) {
          return cbk(null, {public_key: generateSoloKey.pub});
        }

        return getPublicKey({family, lnd: args.lnd}, cbk);
      }],

      // Serialize the swap details
      swapDetails: [
        'generateCoopKey',
        'generateSoloKey',
        'generateSecret',
        'getClaimKey',
        'getEncrypt',
        ({
          generateCoopKey,
          generateSecret,
          generateSoloKey,
          getClaimKey,
          getEncrypt,
        },
        cbk) =>
      {
        const {recovery, request} = encodeOffToOnRequest({
          coop_private_key: generateCoopKey.key,
          coop_public_key_hash: generateCoopKey.hash,
          encrypt: getEncrypt.secret,
          hash: generateSecret.hash,
          key_index: getClaimKey.index,
          public_key: getClaimKey.public_key,
          secret: generateSecret.secret,
          solo_private_key: generateSoloKey.key,
          tokens: args.tokens,
        });

        return cbk(null, {recovery, request});
      }],
    },
    returnResult({reject, resolve, of: 'swapDetails'}, cbk));
  });
};