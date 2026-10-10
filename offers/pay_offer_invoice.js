const asyncAuto = require('async/auto');
const {getNetwork} = require('ln-sync');
const {parseInvoice} = require('invoices');
const {payViaRoutes} = require('ln-service');
const {probeForRoute} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {resolvePathIntroductions} = require('./../network');

const isMtokens = n => typeof n === 'string' && /^\d+$/.test(n);

/** Pay a BOLT 12 invoice over its blinded payment paths

  {
    invoice: <BOLT 12 Invoice String>
    lnd: <Authenticated LND API Object>
    max_fee_mtokens: <Maximum Routing Fee Millitokens String>
  }

  @returns via cbk or Promise
  {
    fee_mtokens: <Fee Paid Millitokens String>
    id: <Payment Hash Hex String>
    mtokens: <Invoice Amount Millitokens String>
    secret: <Payment Preimage Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.invoice || typeof args.invoice !== 'string') {
          return cbk([400, 'ExpectedInvoiceToPayOfferInvoice']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToPayOfferInvoice']);
        }

        // A fee limit is required so that fees cannot run up unchecked
        if (!isMtokens(args.max_fee_mtokens)) {
          return cbk([400, 'ExpectedMaxFeeMillitokensToPayOfferInvoice']);
        }

        return cbk();
      },

      // Read the invoice, which checks its signature
      details: ['validate', ({}, cbk) => {
        try {
          return cbk(null, parseInvoice({invoice: args.invoice}));
        } catch (err) {
          return cbk([400, 'ExpectedValidInvoiceToPay', {err: err.message}]);
        }
      }],

      // Get the network of the node to check the invoice is for it
      getNetwork: ['details', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Check the invoice can be paid
      check: ['details', 'getNetwork', ({details, getNetwork}, cbk) => {
        if (details.is_expired) {
          return cbk([400, 'ExpectedUnexpiredInvoiceToPay']);
        }

        if (details.network !== getNetwork.bitcoinjs) {
          return cbk([400, 'ExpectedInvoiceForNodeNetworkToPay']);
        }

        if (!details.paths.length) {
          return cbk([400, 'ExpectedPaymentPathsInInvoiceToPay']);
        }

        return cbk();
      }],

      // Find the starting node of each payment path
      getPaths: ['check', 'details', ({details}, cbk) => {
        return resolvePathIntroductions({
          lnd: args.lnd,
          paths: details.paths,
        },
        cbk);
      }],

      // Find a route into the blinded payment paths of the invoice
      probe: ['details', 'getPaths', ({details, getPaths}, cbk) => {
        // Exit early when no payment path has a known starting node
        if (!getPaths.paths.length) {
          return cbk([503, 'FailedToFindStartOfOfferInvoicePaymentPaths']);
        }

        return probeForRoute({
          lnd: args.lnd,
          max_fee_mtokens: args.max_fee_mtokens,
          mtokens: details.mtokens,
          paths: getPaths.paths,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          if (!res.route) {
            return cbk([503, 'FailedToFindRouteToPayOfferInvoice']);
          }

          return cbk(null, res.route);
        });
      }],

      // Pay the invoice over the route
      pay: ['details', 'probe', ({details, probe}, cbk) => {
        return payViaRoutes({
          id: details.id,
          lnd: args.lnd,
          routes: [probe],
        },
        cbk);
      }],

      // The payment of the invoice
      paid: ['details', 'pay', ({details, pay}, cbk) => {
        return cbk(null, {
          fee_mtokens: pay.fee_mtokens,
          id: details.id,
          mtokens: details.mtokens,
          secret: pay.secret,
        });
      }],
    },
    returnResult({reject, resolve, of: 'paid'}, cbk));
  });
};
