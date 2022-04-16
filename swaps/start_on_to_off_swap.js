const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {createHodlInvoice} = require('ln-service');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {parsePaymentRequest} = require('ln-service');
const {networks} = require('bitcoinjs-lib');
const {returnResult} = require('asyncjs-util');
const tinysecp = require('tiny-secp256k1');

const decodeOffToOnRequest = require('./decode_off_to_on_request');
const encodeOffToOnResponse = require('./encode_off_to_on_response');

const bufferAsHex = buffer => buffer.toString('hex');
const defaultSwapExpiryMs = 1000 * 60 * 30;
const family = 805;
const maxSwapDelta = 144 * 30;
const minSwapDelta = 80;
const {now} = Date;
const refundDelta = 144;
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');

/** Start the on-chain to off-chain swap

  {
    delta: <Swap CLTV Delta Number>
    deposit: <Unilateral Deposit Tokens Number>
    [is_external_solo_key]: <Use External Unilateral Refund Key Bool>
    lnd: <Authenticated LND API Object>
    price: <Swap Price Tokens Number>
    request: <Swap Request Hex String>
  }

  @returns via cbk or Promise
  {
    recovery: <Swap Recovery Details Hex String>
    response: <Swap Response Details Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import the ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!args.delta) {
          return cbk([400, 'ExpectedCltvDeltaToStartOnToOffSwap']);
        }

        if (args.delta > maxSwapDelta) {
          return cbk([400, 'ExpectedShorterSwapDeltaToStartOnToOffSwap']);
        }

        if (args.delta < minSwapDelta) {
          return cbk([400, 'ExpectedLongerSwapDeltaToStartOnToOffSwap']);
        }

        if (!args.deposit) {
          return cbk([400, 'ExpectedDepositAmountToStartOnToOffSwap']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToStartOnToOffSwap']);
        }

        if (args.price === undefined) {
          return cbk([400, 'ExpectedSwapPriceToStartOnToOffSwap']);
        }

        try {
          decodeOffToOnRequest({request: args.request});
        } catch (err) {
          return cbk([400, 'ExpectedValidRequestToStartOnToOffSwap', {err}]);
        }

        return cbk();
      },

      // Get the current best chain height to calculate the timeout height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the identity public key to generate the encryption key
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network name for the cooperative key
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Decode the request details
      requestDetails: ['validate', ({}, cbk) => {
        const details = decodeOffToOnRequest({request: args.request});

        return cbk(null, {
          coop_public_key_hash: details.coop_public_key_hash,
          hash: details.hash,
          public_key: details.solo_public_key,
          tokens: details.tokens,
        });
      }],

      // Bitcoinjs network name
      network: ['getNetwork', ({getNetwork}, cbk) => {
        const network = networks[getNetwork.bitcoinjs];

        if (!network) {
          return cbk([400, 'UnsupportedNetworkForOnToOffSwap']);
        }

        return cbk(null, network);
      }],

      // Generate the refund coop key
      generateCoopKey: ['ecp', 'network', ({ecp, network}, cbk) => {
        const {privateKey, publicKey} = ecp.makeRandom({network});

        return cbk(null, {
          hash: sha256(privateKey),
          private: bufferAsHex(privateKey),
          public: bufferAsHex(publicKey),
        });
      }],

      // Generate the refund solo key
      generateSoloKey: ['ecp', 'network', ({ecp, network}, cbk) => {
        if (!args.is_external_solo_key) {
          return cbk(null, {});
        }

        const {privateKey, publicKey} = ecp.makeRandom({network});

        return cbk(null, {
          private: bufferAsHex(privateKey),
          public: bufferAsHex(publicKey),
        });
      }],

      // Make the execution request with the private coop key as hash preimage
      createExecInvoice: ['generateCoopKey', ({generateCoopKey}, cbk) => {
        return createHodlInvoice({
          cltv_delta: args.delta + refundDelta,
          expires_at: new Date(now() + defaultSwapExpiryMs).toISOString(),
          id: generateCoopKey.hash,
          lnd: args.lnd,
          tokens: args.deposit,
        },
        cbk);
      }],

      // Make the funding invoice that corresponds to the amount minus fee
      createFundInvoice: ['requestDetails', ({requestDetails}, cbk) => {
        return createHodlInvoice({
          cltv_delta: args.delta + refundDelta,
          expires_at: new Date(now() + defaultSwapExpiryMs).toISOString(),
          id: requestDetails.hash,
          lnd: args.lnd,
          tokens: requestDetails.tokens + args.price,
        },
        cbk);
      }],

      // Make the push preimage invoice for cooperative settlement
      createPushInvoice: ['requestDetails', ({requestDetails}, cbk) => {
        return createHodlInvoice({
          cltv_delta: args.delta + refundDelta,
          expires_at: new Date(now() + defaultSwapExpiryMs).toISOString(),
          id: requestDetails.coop_public_key_hash,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Compute an encryption secret for encrypting private state data
      getEncrypt: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd: args.lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Get the refund unilateral key
      getRefundKey: ['generateSoloKey', ({generateSoloKey}, cbk) => {
        // Exit early when using an external key
        if (!!generateSoloKey.public) {
          return cbk(null, {public_key: generateSoloKey.public});
        }

        return getPublicKey({family, lnd: args.lnd}, cbk);
      }],

      // Final details
      swap: [
        'createExecInvoice',
        'createFundInvoice',
        'createPushInvoice',
        'generateCoopKey',
        'generateSoloKey',
        'getEncrypt',
        'getHeight',
        'getRefundKey',
        'requestDetails',
        ({
          createExecInvoice,
          createFundInvoice,
          createPushInvoice,
          generateCoopKey,
          generateSoloKey,
          getEncrypt,
          getHeight,
          getRefundKey,
          requestDetails,
        },
        cbk) =>
      {
        const {recovery, response} = encodeOffToOnResponse({
          claim_public_key: requestDetails.public_key,
          coop_private_key: generateCoopKey.private,
          coop_public_key: generateCoopKey.public,
          coop_public_key_hash: requestDetails.coop_public_key_hash,
          deposit: createExecInvoice.request,
          encrypt: getEncrypt.secret,
          hash: requestDetails.hash,
          key_index: getRefundKey.index,
          push: createPushInvoice.request,
          refund_public_key: getRefundKey.public_key,
          request: createFundInvoice.request,
          solo_private_key: generateSoloKey.private,
          timeout: getHeight.current_block_height + args.delta,
          tokens: requestDetails.tokens,
        });

        return cbk(null, {recovery, response});
      }],
    },
    returnResult({reject, resolve, of: 'swap'}, cbk));
  });
};
