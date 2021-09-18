const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {cancelHodlInvoice} = require('ln-service');
const {createHodlInvoice} = require('ln-service');
const {getFeeRates} = require('ln-service');
const {getHeight} = require('ln-service');
const {getInvoice} = require('ln-service');
const {probeForRoute} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {decodeRelayArguments} = require('./../records');
const {isRelayConfigured} = require('./../config');
const {sendRelayPayment} = require('./../actions');

const defaultCltvDelta = 80;
const defaultProbeTimeoutMs = 1000 * 60 * 5;
const expiresAt = () => new Date(Date.now() + 1000 * 60 * 30).toISOString();
const interval = 1000 * 60 * 10;
const rateDivisor = BigInt(1e6);
const sumOf = arr => arr.reduce((sum, n) => BigInt(n) + n, BigInt(0));
const text = 'Relay payment request created';
const times = 12;

/** Generate a response for a relay request

  As arguments a payment request can be passed as text or as payreq records

  {
    arguments: <Arguments TLV Stream Hex String>
    env: <Environment Variables Object>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
  }

  @returns
  {
    [error]: [
      <Error Code Number>
      <Error Code Type String>
    ]
    [response]: {
      paywall: <Paywall BOLT 11 Request String>
      text: <Response Text String>
    }
  }
*/
module.exports = ({arguments, env, lnd, network}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!arguments) {
          return cbk([400, 'ExpectedServiceRequestArgumentsForRelayService']);
        }

        // Check that the arguments are a valid TLV stream
        try {
          decodeRelayArguments({arguments, network});
        } catch (err) {
          return cbk([400, err.message]);
        }

        if (!env) {
          return cbk([400, 'ServerConfigurationMissingForRelayService']);
        }

        if (!isRelayConfigured({env})) {
          return cbk([404, 'RelayServiceNotSupported']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndForRelayService']);
        }

        return cbk();
      },

      // Parse the relay arguments
      details: ['validate', ({}, cbk) => {
        const records = decodeRelayArguments({arguments, network});

        return cbk(null, {
          cltv_delta: records.cltv_delta,
          description: records.description,
          destination: records.destination,
          expires_at: records.expires_at,
          features: records.features,
          id: records.id,
          mtokens: records.mtokens,
          payment: records.payment,
          routes: records.routes,
        });
      }],

      // Get the fee rates to find the fee for the relay
      getFees: ['validate', ({}, cbk) => getFeeRates({lnd}, cbk)],

      // Get the invoice to make sure it doesn't exist
      getExisting: ['details', ({details}, cbk) => {
        return getInvoice({lnd, id: details.id}, (err, res) => {
          if (!err) {
            return cbk([409, 'InvoiceWithPaymentHashAlreadyExists']);
          }

          return cbk();
        });
      }],

      // Probe to confirm a path to the destination
      probe: ['details', 'getExisting', ({details}, cbk) => {
        return probeForRoute({
          lnd,
          cltv_delta: details.cltv_delta,
          destination: details.destination,
          features: details.features,
          mtokens: details.mtokens,
          payment: details.payment,
          probe_timeout_ms: defaultProbeTimeoutMs,
          routes: details.routes,
          total_mtokens: details.mtokens,
        },
        cbk);
      }],

      // Calculate the fee to charge for the relay
      fee: ['getFees', 'probe', ({getFees, probe}, cbk) => {
        const {route} = probe;

        if (!route) {
          return cbk([503, 'FailedToFindRouteToPayRequest']);
        }

        const [{channel}] = route.hops;

        // The fee policy for the relay will be the fee rate for the channel
        const policyForChannel = getFees.channels.find(n => n.id === channel);

        if (!policyForChannel) {
          return cbk([503, 'FailedToFindFeePolicyForRoute']);
        }

        const baseFeeMtokens = BigInt(policyForChannel.base_fee_mtokens);
        const feeRate = BigInt(policyForChannel.fee_rate);
        const forwardMtokens = BigInt(probe.route.mtokens);

        const fee = baseFeeMtokens + forwardMtokens * feeRate / rateDivisor;

        return cbk(null, {mtokens: fee.toString()});
      }],

      // Get the current height
      getHeight: ['probe', ({}, cbk) => getHeight({lnd}, cbk)],

      // Create the relay invoice
      createRelay: [
        'fee',
        'details',
        'getHeight',
        'probe',
        ({fee, details, getHeight, probe}, cbk) =>
      {
        if (details.expires_at < new Date().toISOString()) {
          return cbk([400, 'InvoiceIsExpired']);
        }

        // A HTLC held locally needs a long CLTV to cover the next hops.
        const cltvDelta = probe.route.timeout - getHeight.current_block_height;

        // Amounts to request as BigInts
        const amounts = [details.mtokens, fee.mtokens].map(n => BigInt(n));

        // Total mtokens to charge
        const mtokens = amounts.reduce((sum, n) => sum + n, BigInt(Number()));

        // The incoming HTLC will get held for the route timeout + a buffer.
        // The peer could still use the preimage until the timeout is swept.
        // To allow time to sweep that timeout path, a CLTV delta is added.
        return createHodlInvoice({
          lnd,
          cltv_delta: cltvDelta + defaultCltvDelta,
          description: details.description,
          description_hash: details.description_hash,
          expires_at: expiresAt(),
          id: details.id,
          mtokens: mtokens.toString(),
        },
        cbk);
      }],

      // Wait for the HTLC to be attached to the HODL invoice
      waitForHold: [
        'createRelay',
        'details',
        'probe',
        ({createRelay, details, probe}, cbk) =>
      {
        const [{channel}] = probe.route.hops;

        const {id} = details;
        const sub = subscribeToInvoice({lnd, id: createRelay.id});

        sub.on('error', err => {
        });

        sub.on('invoice_updated', async invoice => {
          if (!invoice.is_held) {
            return;
          }

          sub.removeAllListeners();

          return asyncRetry({interval, times}, cbk => {
            return sendRelayPayment({
              lnd,
              cltv_delta: details.cltv_delta,
              destination: details.destination,
              expires_at: details.expires_at,
              features: details.features,
              id: details.id,
              max_mtokens: probe.route.mtokens,
              mtokens: details.mtokens,
              outgoing_channel: channel,
              payment: details.payment,
              payments: invoice.payments,
              routes: details.routes,
            },
            cbk);
          },
          err => {
            if (!!err) {
              return cancelHodlInvoice({lnd, id: details.id}, err => {
                return;
              });
            }

            return;
          })
        });

        return cbk(null, sub);
      }],

      // Final response to return
      response: ['createRelay', ({createRelay}, cbk) => {
        return cbk(null, {response: {text, paywall: createRelay.request}});
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
