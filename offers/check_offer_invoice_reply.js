const {parseInvoice} = require('invoices');
const {parseInvoiceError} = require('invoices');

const {typeInvoiceError} = require('./constants');

/** Check that a reply to an invoice request is an invoice for the request

  An invoice error reply from the recipient, or an invoice that is not valid,
  that has expired, or that is not for the request, is a failed reply

  {
    reply: {
      type: <Reply Message Payload Record Type Number String>
      value: <Reply Message Payload Hex String>
    }
    request: {
      mtokens: <Requested Millitokens String>
      request: <BOLT 12 Invoice Request String>
    }
  }

  @returns
  {
    [error]: [<Error Code Number>, <Error Message String>, <Details Object>]
    [invoice]: {
      expires_at: <Invoice Expires At ISO 8601 Date String>
      id: <Payment Hash Hex String>
      invoice: <BOLT 12 Invoice String>
      mtokens: <Invoice Amount Millitokens String>
    }
  }
*/
module.exports = ({reply, request}) => {
  // Exit early when the recipient sent back an invoice error
  if (reply.type === typeInvoiceError) {
    try {
      const error = parseInvoiceError({encoded: reply.value});

      return {
        error: [503, 'OfferInvoiceRequestFailed', {
          erroneous_field: error.erroneous_field,
          message: error.message,
        }],
      };
    } catch (err) {
      return {error: [503, 'OfferInvoiceRequestFailed', {}]};
    }
  }

  // Exit early when the invoice cannot be read or is not for the request
  try {
    parseInvoice({encoded: reply.value, request: request.request});
  } catch (err) {
    return {error: [503, 'ExpectedValidInvoiceForOffer', {err: err.message}]};
  }

  const invoice = parseInvoice({
    encoded: reply.value,
    request: request.request,
  });

  if (invoice.is_expired) {
    return {error: [503, 'ExpectedUnexpiredInvoiceForOffer']};
  }

  if (invoice.mtokens !== request.mtokens) {
    return {error: [503, 'ExpectedInvoiceForRequestedAmount']};
  }

  if (!invoice.paths.length) {
    return {error: [503, 'ExpectedPaymentPathsInInvoiceForOffer']};
  }

  return {
    invoice: {
      expires_at: invoice.expires_at,
      id: invoice.id,
      invoice: invoice.invoice,
      mtokens: invoice.mtokens,
    },
  };
};
