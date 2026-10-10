const {createHash} = require('node:crypto');

const {createSignedInvoice} = require('invoices');
const {createUnsignedInvoice} = require('invoices');

const bufferAsHex = buffer => buffer.toString('hex');
const issuerSecret = bufferAsHex(Buffer.alloc(32, 1));
const sha256 = n => createHash('sha256').update(n).digest('hex');

/** Make a BOLT 12 invoice for a request of an offer of the issuer of secret 1

  {
    [created_at]: <Invoice Created At ISO 8601 Date String>
    encoded: <Invoice Request TLV Stream Hex String>
    [expires_at]: <Invoice Expires At ISO 8601 Date String>
    paths: [<Blinded Payment Path Object>]
  }

  @returns
  {
    encoded: <Signed Invoice TLV Stream Hex String>
    invoice: <BOLT 12 Invoice String>
  }
*/
module.exports = ({created_at, encoded, expires_at, paths}) => {
  const unsigned = createUnsignedInvoice({
    created_at,
    encoded,
    expires_at,
    paths,
    id: sha256(encoded),
  })
  .encoded;

  return createSignedInvoice({encoded: unsigned, secret: issuerSecret});
};
