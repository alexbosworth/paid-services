const {createInvoiceError} = require('invoices');
const {encodeTlvStream} = require('bolt01');

const {typeReplyTooLarge} = require('./constants');

/** Make an invoice error to send back as the reply to an invoice request,
  with a reply too large record after the BOLT 12 error records when the
  reply did not fit the size of a regular request

  {
    [erroneous_field]: <Erroneous Record Type Number String>
    [is_reply_too_large]: <Reply Does Not Fit Size of Regular Request Bool>
    message: <Error Message String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Invoice Error TLV Stream Hex String>
  }
*/
module.exports = args => {
  const {encoded} = createInvoiceError({
    erroneous_field: args.erroneous_field,
    message: args.message,
  });

  // Exit early when the error is not about the size of the reply
  if (!args.is_reply_too_large) {
    return {encoded};
  }

  // The reply too large record is after the BOLT 12 error records
  const tooLarge = encodeTlvStream({
    records: [{type: typeReplyTooLarge, value: String()}],
  });

  return {encoded: encoded + tooLarge.encoded};
};
