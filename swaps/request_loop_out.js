const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const {beginGroupSigningSession} = require('ln-service');
const {createTaprootSwapOut} = require('goldengate');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getHeight} = require('ln-service');
const {getIdentity} = require('ln-service');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {getSwapMacaroon} = require('goldengate');
const {getSwapOutQuote} = require('goldengate');
const {hashForTree} = require('p2tr');
const {lightningLabsSwapAuth} = require('goldengate');
const {lightningLabsSwapService} = require('goldengate');
const {parsePaymentRequest} = require('ln-service');
const {pay} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {swapScriptBranches} = require('goldengate');
const tinysecp = require('tiny-secp256k1');

const decodeLoopResponse = require('./decode_loop_response');
const decodeOffToOnRecovery = require('./decode_off_to_on_recovery');
const encodeLoopResponse = require('./encode_loop_response');

const defaultFundAt = () => new Date(Date.now() + (1000 * 60)).toISOString();
const family = 805;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const maxServiceFee = 1337;
const maxRoutingFee = 100;
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const timeoutHeight = current => 400 + current - 3;

/** Request an offchain to onchain swap from the Lightning Loop server

  {
    [before]: <Request Publishing On-Chain Before ISO 8601 Date String>
    lnd: <Authenticated LND API Object>
    recovery: <Swap Out Recovery Hex String>
  }

  @returns via cbk or Promise
  {
    response: <Hex Encoded Lightning Loop Response String>
  }
*/
module.exports = ({before, lnd, recovery}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Import ECPair library
      ecp: async () => (await import('ecpair')).ECPairFactory(tinysecp),

      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRequestLoopOut']);
        }

        if (!recovery) {
          return cbk([400, 'ExpectedRequestRecoveryToRequestLoopOut']);
        }

        return cbk();
      },

      // Get the self public key to use for the decryption key
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd}, cbk)],

      // Get the encryption key to decode the recovery secrets
      getDecrypt: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Initialize the service
      service: ['getNetwork', ({getNetwork}, cbk) => {
        const {network} = getNetwork;

        return cbk(null, lightningLabsSwapService({network}).service);
      }],

      // Decode swap request details
      requestDetails: ['getDecrypt', ({getDecrypt}, cbk) => {
        const decoded = decodeOffToOnRecovery({
          recovery,
          decrypt: getDecrypt.secret,
        });

        return cbk(null, {
          hash: sha256(hexAsBuffer(decoded.secret)),
          index: decoded.key_index,
          tokens: decoded.tokens,
        });
      }],

      // Get the public key for the swap
      getKey: ['requestDetails', ({requestDetails}, cbk) => {
        return getPublicKey({family, lnd, index: requestDetails.index}, cbk);
      }],

      // Get an unpaid swap macaroon
      getUnpaidMacaroon: ['service', ({service}, cbk) => {
        return getSwapMacaroon({service}, cbk);
      }],

      // Pay for the macaroon
      payForMacaroon: ['getUnpaidMacaroon', ({getUnpaidMacaroon}, cbk) => {
        const {request} = getUnpaidMacaroon;

        // Validate the service token payment request
        if (parsePaymentRequest({request}).tokens > maxServiceFee) {
          return cbk([503, 'ExpectedLowerPriceForLoopApiKey', {fee: tokens}]);
        }

        // Pay the service token payment request to purchase the macaroon
        return pay({lnd, request, max_fee: maxRoutingFee}, cbk);
      }],

      // Create authentication metadata object
      metadata: [
        'getUnpaidMacaroon',
        'payForMacaroon',
        ({getUnpaidMacaroon, payForMacaroon}, cbk) =>
      {
        if (!payForMacaroon.secret) {
          return cbk([400, 'FailedToPurchasePaidServiceTokenFromLoopService']);
        }

        const {macaroon} = getUnpaidMacaroon;
        const preimage = payForMacaroon.secret;

        return cbk(null, lightningLabsSwapAuth({macaroon, preimage}).metadata);
      }],

      // Final service method details
      paidService: ['metadata', 'service', ({metadata, service}, cbk) => {
        return cbk(null, {metadata, service});
      }],

      // Starting height
      startHeight: ['paidService', ({}, cbk) => getHeight({lnd}, cbk)],

      // Get the quote for swaps
      getQuote: [
        'paidService',
        'requestDetails',
        'startHeight',
        ({paidService, requestDetails, startHeight}, cbk) =>
      {
        return getSwapOutQuote({
          fund_at: before || defaultFundAt(),
          metadata: paidService.metadata,
          service: paidService.service,
          timeout: timeoutHeight(startHeight.current_block_height),
          tokens: requestDetails.tokens,
        },
        cbk);
      }],

      // Create the swap
      create: [
        'getKey',
        'getNetwork',
        'metadata',
        'requestDetails',
        'service',
        'startHeight',
        ({
          getKey,
          getNetwork,
          metadata,
          requestDetails,
          service,
          startHeight,
        },
        cbk) =>
      {
        return createTaprootSwapOut({
          metadata,
          service,
          fund_at: before || defaultFundAt(),
          hash: requestDetails.hash,
          network: getNetwork.network,
          public_key: getKey.public_key,
          timeout: timeoutHeight(startHeight.current_block_height),
          tokens: requestDetails.tokens,
        },
        cbk);
      }],

      // Derive swap script branches
      script: [
        'create',
        'ecp',
        'getKey',
        'requestDetails',
        'startHeight',
        ({create, ecp, getKey, requestDetails, startHeight}, cbk) =>
      {
        try {
          const swap = swapScriptBranches({
            ecp,
            claim_public_key: getKey.public_key,
            hash: requestDetails.hash,
            refund_public_key: create.service_public_key,
            timeout: timeoutHeight(startHeight.current_block_height),
          });

          return cbk(null, {branches: swap.branches, claim: swap.claim});
        } catch (err) {
          return cbk([503, 'failedToDeriveSwapScriptBranches', {err}]);
        }
      }],

      // Start the MuSig2 session with the server key
      start: [
        'create',
        'getKey',
        'requestDetails',
        'script',
        ({create, getKey, requestDetails, script}, cbk) =>
      {
        return beginGroupSigningSession({
          lnd,
          key_family: family,
          key_index: requestDetails.index,
          public_keys: [getKey.public_key, create.service_public_key],
          root_hash: hashForTree({branches: script.branches}).hash,
        },
        cbk);
      }],

      // Final swap details
      swap: [
        'create',
        'getUnpaidMacaroon',
        'payForMacaroon',
        'startHeight',
        ({create, getUnpaidMacaroon, payForMacaroon, startHeight}, cbk) =>
      {
        // Encode the response as a TLV stream
        const {response} = encodeLoopResponse({
          deposit: create.swap_execute_request,
          fund: create.swap_fund_request,
          macaroon: getUnpaidMacaroon.macaroon,
          preimage: payForMacaroon.secret,
          remote: create.service_public_key,
          timeout: timeoutHeight(startHeight.current_block_height),
        });

        return cbk(null, {response});
      }],
    },
    returnResult({reject, resolve, of: 'swap'}, cbk));
  });
};
