const {createHash} = require('crypto');

const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {beginGroupSigningSession} = require('ln-service');
const {createSwapOut} = require('goldengate');
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

const decodeOffToOnRecovery = require('./decode_off_to_on_recovery');
const encodeLoopResponse = require('./encode_loop_response');

const defaultFundAt = () => new Date(Date.now() + (1000 * 3600)).toISOString();
const family = 805;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const maxRoutingFee = 100;
const maxServiceFee = 1337;
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const timeoutHeight = current => 400 + current - 3;

/** Request an offchain to onchain swap from the Lightning Loop server

  When a paid macaroon is not specified, a macaroon will be purchased

  {
    [before]: <Request Publishing On-Chain Before ISO 8601 Date String>
    lnd: <Authenticated LND API Object>
    [macaroon]: <Paid Service Macaroon Base64 String>
    [preimage]: <Paid Service Macaroon Payment Preimage Hex String>
    recovery: <Swap Out Recovery Hex String>
    [socket]: <Custom Swap Service Socket String>
  }

  @returns via cbk or Promise
  {
    deposit_request: <Deposit Payment Request BOLT 11 String>
    fund_request: <Funding Payment Request BOLT 11 String>
    response: <Hex Encoded Lightning Loop Response String>
    timeout: <Swap Timeout Path Height Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRequestLoopOut']);
        }

        if (!!args.macaroon && !args.preimage) {
          return cbk([400, 'ExpectedMacaroonPreimageToRequestLoopOut']);
        }

        if (!args.macaroon && !!args.preimage) {
          return cbk([400, 'ExpectedPaidMacaroonToRequestLoopOut']);
        }

        if (!args.recovery) {
          return cbk([400, 'ExpectedRequestRecoveryToRequestLoopOut']);
        }

        return cbk();
      },

      // Get the self public key to use for the decryption key
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Get the network name
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the encryption key to decode the recovery secrets
      getDecrypt: ['getIdentity', ({getIdentity}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd: args.lnd,
          partner_public_key: getIdentity.public_key,
        },
        cbk);
      }],

      // Initialize the service
      service: ['getNetwork', ({getNetwork}, cbk) => {
        const {service} = lightningLabsSwapService({
          network: getNetwork.network,
          socket: args.socket,
        });

        return cbk(null, service);
      }],

      // Decode swap request details
      requestDetails: ['getDecrypt', ({getDecrypt}, cbk) => {
        const decoded = decodeOffToOnRecovery({
          decrypt: getDecrypt.secret,
          recovery: args.recovery,
        });

        return cbk(null, {
          hash: sha256(hexAsBuffer(decoded.secret)),
          index: decoded.key_index,
          tokens: decoded.tokens,
        });
      }],

      // Get the public key for the swap
      getKey: ['requestDetails', ({requestDetails}, cbk) => {
        return getPublicKey({
          family,
          index: requestDetails.index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get an unpaid swap macaroon
      getUnpaidMacaroon: ['service', ({service}, cbk) => {
        // Exit early when there is already a paid macaroon
        if (!!args.macaroon) {
          return cbk(null, {macaroon: args.macaroon});
        }

        return getSwapMacaroon({service}, cbk);
      }],

      // Pay for the macaroon
      payForMacaroon: ['getUnpaidMacaroon', ({getUnpaidMacaroon}, cbk) => {
        // Exit early when the macaroon was already paid for
        if (!!args.preimage) {
          return cbk(null, {secret: args.preimage});
        }

        const {request} = getUnpaidMacaroon;

        const {tokens} = parsePaymentRequest({request});

        // Validate the service token payment request
        if (tokens > maxServiceFee) {
          return cbk([503, 'ExpectedLowerPriceForLoopApiKey', {fee: tokens}]);
        }

        // Pay the service token payment request to purchase the macaroon
        return pay({request, lnd: args.lnd, max_fee: maxRoutingFee}, cbk);
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

      // Starting height
      startHeight: ['metadata', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Get the quote for swaps
      getQuote: [
        'metadata',
        'requestDetails',
        'service',
        'startHeight',
        ({metadata, requestDetails, service, startHeight}, cbk) =>
      {
        return getSwapOutQuote({
          metadata,
          service,
          delay: args.before || defaultFundAt(),
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
        return createSwapOut({
          metadata,
          service,
          fund_at: args.before || defaultFundAt(),
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
        'getKey',
        'requestDetails',
        'startHeight',
        asyncify(({create, getKey, requestDetails, startHeight}) =>
      {
        try {
          const swap = swapScriptBranches({
            claim_public_key: getKey.public_key,
            hash: requestDetails.hash,
            refund_public_key: create.service_public_key,
            timeout: timeoutHeight(startHeight.current_block_height),
          });

          return {branches: swap.branches, claim: swap.claim};
        } catch (err) {
          throw [503, 'failedToDeriveSwapScriptBranches', {err}];
        }
      })],

      // Start the MuSig2 session with the server key
      start: [
        'create',
        'getKey',
        'requestDetails',
        'script',
        ({create, getKey, requestDetails, script}, cbk) =>
      {
        return beginGroupSigningSession({
          key_family: family,
          key_index: requestDetails.index,
          lnd: args.lnd,
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
        const timeout = timeoutHeight(startHeight.current_block_height);

        // Encode the response as a TLV stream
        const {response} = encodeLoopResponse({
          timeout,
          deposit: create.swap_execute_request,
          fund: create.swap_fund_request,
          macaroon: getUnpaidMacaroon.macaroon,
          preimage: payForMacaroon.secret,
          remote: create.service_public_key,
        });

        return cbk(null, {
          response,
          timeout,
          deposit_request: create.swap_execute_request,
          fund_request: create.swap_fund_request,
        });
      }],
    },
    returnResult({reject, resolve, of: 'swap'}, cbk));
  });
};
