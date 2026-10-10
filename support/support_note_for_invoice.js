const {createHash} = require('node:crypto');

const {parseInvoice} = require('invoices');

const {decodeRecords} = require('./../service_records');
const openSupportNote = require('./open_support_note');
const {typeInvoiceSupportNote} = require('./constants');

const bufferAsHex = buffer => buffer.toString('hex');
const isPreimage = n => typeof n === 'string' && /^[0-9a-f]{64}$/i.test(n);
const sha256 = hex => createHash('sha256').update(Buffer.from(hex, 'hex'));

/** Open the support note of a paid BOLT 12 invoice with its payment preimage

  An invoice without a note, or with a note that cannot be opened, has no
  note. Show the note as plain text from the recipient.

  {
    invoice: <BOLT 12 Invoice String>
    preimage: <Payment Preimage Hex String>
  }

  @throws
  <Error>

  @returns
  {
    [note]: <Support Note Text String>
  }
*/
module.exports = ({invoice, preimage}) => {
  if (!isPreimage(preimage)) {
    throw new Error('ExpectedPaymentPreimageToOpenSupportNote');
  }

  let details;

  try {
    details = parseInvoice({invoice});
  } catch (err) {
    throw new Error('ExpectedValidInvoiceToOpenSupportNote');
  }

  // The preimage is the one that the invoice is paid with
  if (bufferAsHex(sha256(preimage).digest()) !== details.id) {
    throw new Error('ExpectedPaymentPreimageOfInvoiceToOpenSupportNote');
  }

  const {records} = decodeRecords({encoded: details.encoded});

  const record = records.find(n => n.type === typeInvoiceSupportNote);

  // Exit early when there is no note
  if (!record) {
    return {};
  }

  try {
    return openSupportNote({preimage, encoded: record.value});
  } catch (err) {
    return {};
  }
};
