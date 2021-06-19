const asyncAuto = require('async/auto');
const {getHeight} = require('ln-service');
const {getPayment} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {probeForRoute} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');

const cltvDeltaBuffer = 6;
const defaultProbeTimeoutMs = 1000 * 60 * 30;
const {isArray} = Array;
const maxHoldBlocks = 2016;
const {min} = Math;
const minCltvDelta = 70;
const minHoldBlocks = 50;

/** Relay a payment for the relay service

  {
    cltv_delta: <Final CLTV Delta Number>
    destination: <Payment Destination Public Key Hex String>
    expires_at: <Invoice Expires at ISO 8601 Date String>
    features: [{
      bit: <Feature Bit Number>
    }]
    id: <Payment Hash Hex String>
    lnd: <Authenticated LND API Object>
    max_mtokens: <Millitokens String>
    mtokens: <Millitokens String>
    outgoing_channel: <Send Out Channel Id String>
    [payment]: <Payment Identifier Hex String>
    payments: [{
      [is_held]: <Payment Is Held Bool>
      timeout: <CLTV Timeout Height Number>
    }]
    routes: [[{
      base_fee_mtokens: <Base Routing Fee In Millitokens Number>
      channel: <Standard Format Channel Id String>
      cltv_delta: <CLTV Blocks Delta Number>
      fee_rate: <Fee Rate In Millitokens Per Million Number>
      public_key: <Public Key Hex String>
    }]]
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.cltv_delta) {
          return cbk([400, 'ExpectedCltvDeltaToRelayPayment']);
        }

        if (!args.destination) {
          return cbk([400, 'ExpectedDestinationPublicKeyToRelayPayment']);
        }

        if (!args.expires_at) {
          return cbk([400, 'ExpectedExpirationDateToRelayPayment']);
        }

        if (args.expires_at < new Date().toISOString()) {
          return cbk([400, 'ExpectedUnexpiredInvoiceToSendRelayPayment']);
        }

        if (!args.id) {
          return cbk([400, 'ExpectedPaymentHashToRelayPayment']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatetdLndToRelayPayment']);
        }

        if (!args.outgoing_channel) {
          return cbk([400, 'ExpectedOutChannelToRelayPayment']);
        }

        if (!args.max_mtokens) {
          return cbk([400, 'ExpectedMaxMillitokensToRelayPayment']);
        }

        if (!args.mtokens) {
          return cbk([400, 'ExpectedMillitokensToRelayPayment']);
        }

        if (!isArray(args.payments)) {
          return cbk([400, 'ExpectedHeldPaymentsArrayToRelayPayment']);
        }

        return cbk();
      },

      // Find a route
      getRoute: ['validate', ({}, cbk) => {
        return probeForRoute({
          cltv_delta: args.cltv_delta + cltvDeltaBuffer,
          destination: args.destination,
          features: args.features,
          lnd: args.lnd,
          mtokens: args.mtokens,
          outgoing_channel: args.outgoing_channel,
          payment: args.payment,
          probe_timeout_ms: defaultProbeTimeoutMs,
          routes: args.routes,
          total_mtokens: !!args.payment ? args.mtokens : undefined,
        },
        cbk);
      }],

      // Check route price
      checkFee: ['getRoute', ({getRoute}, cbk) => {
        // Exit early when there is no route to complete the relay
        if (!getRoute.route) {
          return cbk([503, 'FailedToFindRouteToDestination']);
        }

        // Exit early when the route is more expensive than it was before
        if (BigInt(getRoute.route.mtokens) > BigInt(args.max_mtokens)) {
          return cbk([503, 'UnexpectedFeeToRouteToDestination']);
        }

        return cbk();
      }],

      // Get the current height
      getHeight: ['getRoute', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Make sure there is enough time to complete the relay
      checkTimeout: ['getHeight', 'getRoute', ({getHeight, getRoute}, cbk) => {
        const chainHeight = getHeight.current_block_height;

        // The earliest timeout is the one that counts
        const timeouts = args.payments
          .filter(n => n.is_held)
          .map(n => n.timeout);

        // At the lowest hold height the incoming HTLC will be lost
        const blocksUntilHoldLost = min(...timeouts) - chainHeight;

        // Exit early when the hold is for too long a time
        if (blocksUntilHoldLost > maxHoldBlocks) {
          return cbk([503, 'BlockHoldingPeriodExceedsMaximum']);
        }

        // Exit early when there aren't enough blocks left to relay
        if (blocksUntilHoldLost < minHoldBlocks) {
          return cbk([503, 'ExpectedMoreCltvBlockDeltaRemaining']);
        }

        const blocksUntilPayTimeout = getRoute.route.timeout - chainHeight;

        // Exit early when there is not enough gap between the HTLCs
        if (blocksUntilHoldLost - blocksUntilPayTimeout < minCltvDelta) {
          return cbk([503, 'ExpectedHigherCltvDeltaBetweenInvoiceAndRoute']);
        }

        return cbk();
      }],

      // Buy the preimage from the original destination
      pay: ['checkFee', 'checkTimeout', 'getRoute', ({getRoute}, cbk) => {
        if (args.expires_at < new Date().toISOString()) {
          return cbk([400, 'ExpectedUnexpiredInvoiceToPayRelayPayment']);
        }

        return payViaRoutes({
          id: args.id,
          lnd: args.lnd,
          routes: [getRoute.route],
        },
        () => {
          // Ignore errors to avoid canceling HTLCs
          return cbk();
        });
      }],

      // Get the payment secret
      getSecret: ['pay', ({}, cbk) => {
        return getPayment({id: args.id, lnd: args.lnd}, (err, res) => {
          // Ignore errors to avoid canceling HTLCs
          if (!!err) {
            return cbk();
          }

          // Payment conclusively failed, cancel relay
          if (!!res.is_failed) {
            return cbk([503, 'FailedToPayRelayPayment']);
          }

          // Exit early when no secret exists
          if (!res.payment) {
            return cbk();
          }

          return cbk(null, res.payment.secret);
        });
      }],

      // Take the incoming funds HTLC
      settle: ['getSecret', ({getSecret}, cbk) => {
        // Exit early when settling is impossible
        if (!getSecret) {
          return cbk();
        }

        return settleHodlInvoice({lnd: args.lnd, secret: getSecret}, cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
