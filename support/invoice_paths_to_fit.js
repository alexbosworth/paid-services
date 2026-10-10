const {createUnsignedInvoice} = require('invoices');

const {typePayerOffer} = require('./constants');
const {withoutRecord} = require('./../service_records');

const byteLength = hex => hex.length / 2;
const lengthSignatureRecordBytes = 66;
const onePath = 1;
const signedBytes = hex => byteLength(hex) + lengthSignatureRecordBytes;

/** Get how many payment paths an invoice can have to fit in `bytes`, leaving
  out paths from the last until it fits

  When it does not fit with one path, the payer offer is the problem when
  the invoice would fit without it.

  {
    bytes: <Most Invoice Bytes That Fit Number>
    invoice: {
      created_at: <Invoice Created At ISO 8601 Date String>
      expires_at: <Invoice Expires At ISO 8601 Date String>
      id: <Payment Hash Hex String>
      mtokens: <Invoice Amount Millitokens String>
    }
    paths: [<Blinded Payment Path Object>]
    [records]: [{
      type: <Experimental Invoice Record Type Number String>
      value: <Experimental Invoice Record Value Hex String>
    }]
    request: {
      encoded: <Invoice Request TLV Stream Hex String>
    }
  }

  @throws
  <Error>

  @returns
  {
    [count]: <Number of Payment Paths That Fit Number>
    [is_payer_offer_too_large]: <Fits Without Payer Offer Bool>
  }
*/
module.exports = ({bytes, invoice, paths, records, request}) => {
  // The size of the signed invoice with the first paths
  const size = count => {
    const unsigned = createUnsignedInvoice({
      records,
      created_at: invoice.created_at,
      encoded: request.encoded,
      expires_at: invoice.expires_at,
      id: invoice.id,
      mtokens: invoice.mtokens,
      paths: paths.slice(Number(), count),
    });

    return signedBytes(unsigned.encoded);
  };

  const counts = paths.map((path, i) => paths.length - i);

  const count = counts.find(n => size(n) <= bytes);

  // Exit early when the invoice fits with some of its paths
  if (!!count) {
    return {count};
  }

  // The invoice holds the payer offer record of the request as it is
  const stripped = withoutRecord({
    encoded: request.encoded,
    type: typePayerOffer,
  });

  // Nothing is cut when there is no payer offer, and one path did not fit
  const cutBytes = byteLength(request.encoded) - byteLength(stripped.encoded);

  // The invoice does not fit with one path, so check one path without it
  return {is_payer_offer_too_large: size(onePath) - cutBytes <= bytes};
};
