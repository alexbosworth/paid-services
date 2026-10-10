const asyncAuto = require('async/auto');
const {createSignedInvoice} = require('invoices');
const {createUnsignedInvoice} = require('invoices');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');

const {derivedKeyFamily} = require('./constants');

const {isArray} = Array;
const typeSchnorr = 'schnorr';

/** Sign a BOLT 12 invoice for a supporter request with blinded paths

  The invoice is signed by the derived key of the offer. `records` are added
  to the invoice, like a sealed support note.

  {
    invoice: {
      created_at: <Invoice Created At ISO 8601 Date String>
      expires_at: <Invoice Expires At ISO 8601 Date String>
      id: <Payment Hash Hex String>
      mtokens: <Invoice Amount Millitokens String>
    }
    key_index: <Derived Signing Key Index Number>
    lnd: <Authenticated LND API Object>
    paths: [<Blinded Payment Path Object>]
    [records]: [{
      type: <Experimental Invoice Record Type Number String>
      value: <Experimental Invoice Record Value Hex String>
    }]
    request: {
      encoded: <Invoice Request TLV Stream Hex String>
    }
  }

  @returns via cbk or Promise
  {
    encoded: <Signed Invoice TLV Stream Hex String>
    expires_at: <Invoice Expires At ISO 8601 Date String>
    id: <Payment Hash Hex String>
    invoice: <BOLT 12 Invoice String>
    mtokens: <Invoice Amount Millitokens String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.invoice || !args.invoice.id || !args.invoice.mtokens) {
          return cbk([400, 'ExpectedInvoiceToSignInvoiceForRequest']);
        }

        if (args.key_index === undefined) {
          return cbk([400, 'ExpectedSigningKeyIndexToSignInvoiceForRequest']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSignInvoiceForRequest']);
        }

        if (!isArray(args.paths) || !args.paths.length) {
          return cbk([400, 'ExpectedBlindedPathsToSignInvoiceForRequest']);
        }

        if (!args.request || !args.request.encoded) {
          return cbk([400, 'ExpectedInvoiceRequestToSignInvoiceForRequest']);
        }

        return cbk();
      },

      // Create the unsigned BOLT 12 invoice
      unsigned: ['validate', ({}, cbk) => {
        try {
          return cbk(null, createUnsignedInvoice({
            created_at: args.invoice.created_at,
            encoded: args.request.encoded,
            expires_at: args.invoice.expires_at,
            id: args.invoice.id,
            mtokens: args.invoice.mtokens,
            paths: args.paths,
            records: args.records,
          }));
        } catch (err) {
          return cbk([503, 'FailedToCreateUnsignedInvoice', {err}]);
        }
      }],

      // Sign the invoice with the derived key of the offer
      sign: ['unsigned', ({unsigned}, cbk) => {
        return signBytes({
          key_family: derivedKeyFamily,
          key_index: args.key_index,
          lnd: args.lnd,
          preimage: unsigned.root,
          tag: unsigned.tag,
          type: typeSchnorr,
        },
        cbk);
      }],

      // Assemble the signed invoice
      signed: ['sign', 'unsigned', ({sign, unsigned}, cbk) => {
        try {
          const signed = createSignedInvoice({
            encoded: unsigned.encoded,
            signature: sign.signature,
          });

          return cbk(null, {
            encoded: signed.encoded,
            expires_at: args.invoice.expires_at,
            id: args.invoice.id,
            invoice: signed.invoice,
            mtokens: args.invoice.mtokens,
          });
        } catch (err) {
          return cbk([503, 'FailedToCreateSignedInvoice', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'signed'}, cbk));
  });
};
