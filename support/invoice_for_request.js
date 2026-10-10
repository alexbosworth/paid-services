const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {parseOffer} = require('invoices');
const {parsePaymentRequest} = require('invoices');
const {returnResult} = require('asyncjs-util');

const {invoiceExpiryMs} = require('./constants');

const expiresAt = () => new Date(Date.now() + invoiceExpiryMs).toISOString();
const {isArray} = Array;
const isPositive = n => /^\d+$/.test(n) && BigInt(n) > BigInt(Number());

/** Create an LND invoice with blinded paths to receive the payment of a
  supporter request, expiring in an hour

  The request has to have an amount above zero to pay.

  {
    lnd: <Authenticated LND API Object>
    request: {
      encoded: <Invoice Request TLV Stream Hex String>
      mtokens: <Requested Amount Millitokens String>
      offer: <BOLT 12 Offer String>
    }
  }

  @returns via cbk or Promise
  {
    created_at: <Invoice Created At ISO 8601 Date String>
    expires_at: <Invoice Expires At ISO 8601 Date String>
    id: <Payment Hash Hex String>
    mtokens: <Invoice Amount Millitokens String>
    paths: [<Blinded Payment Path Object>]
    secret: <Payment Preimage Hex String>
  }
*/
module.exports = ({lnd, request}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToCreateInvoiceForRequest']);
        }

        if (!request || !request.encoded || !request.offer) {
          return cbk([400, 'ExpectedOfferInvoiceRequestToCreateInvoice']);
        }

        if (!request.mtokens) {
          return cbk([400, 'ExpectedAmountToCreateInvoiceForSupporter']);
        }

        if (!isPositive(request.mtokens)) {
          return cbk([400, 'ExpectedNonZeroAmountForSupportInvoice']);
        }

        return cbk();
      },

      // Read the description of the offer to use for the invoice
      description: ['validate', ({}, cbk) => {
        try {
          return cbk(null, parseOffer({offer: request.offer}).description);
        } catch (err) {
          return cbk([400, 'ExpectedValidOfferToCreateInvoiceForRequest']);
        }
      }],

      // Create an LND invoice with blinded paths to receive the payment
      createInvoice: ['description', ({description}, cbk) => {
        return createInvoice({
          description,
          lnd,
          expires_at: expiresAt(),
          mtokens: request.mtokens,
          is_encrypting_routes: true,
        },
        cbk);
      }],

      // Get the blinded payment paths of the LND invoice
      paths: ['createInvoice', ({createInvoice}, cbk) => {
        try {
          const details = parsePaymentRequest({
            request: createInvoice.request,
          });

          if (!isArray(details.paths) || !details.paths.length) {
            return cbk([503, 'ExpectedBlindedPathsInInvoiceForRequest']);
          }

          return cbk(null, {
            expires_at: details.expires_at,
            paths: details.paths,
          });
        } catch (err) {
          return cbk([503, 'FailedToParseInvoiceForRequest', {err}]);
        }
      }],

      // The invoice can be paid over its blinded paths
      invoice: ['createInvoice', 'paths', ({createInvoice, paths}, cbk) => {
        return cbk(null, {
          created_at: createInvoice.created_at,
          expires_at: paths.expires_at,
          id: createInvoice.id,
          mtokens: request.mtokens,
          paths: paths.paths,
          secret: createInvoice.secret,
        });
      }],
    },
    returnResult({reject, resolve, of: 'invoice'}, cbk));
  });
};
