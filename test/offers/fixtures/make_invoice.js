const {createHash} = require('node:crypto');

const {createSignedInvoice} = require('invoices');
const {createUnsignedInvoice} = require('invoices');

const bufferAsHex = buffer => buffer.toString('hex');
const issuerSecret = bufferAsHex(Buffer.alloc(32, 1));
const sha256 = n => createHash('sha256').update(n).digest('hex');

/** Make a BOLT 12 invoice for a request of an offer, signed by the issuer of
  secret 1 by default

  Give the `node_id` and `secret` of another node to sign the invoice as it,
  like the final node of an offer path

  {
    [created_at]: <Invoice Created At ISO 8601 Date String>
    encoded: <Invoice Request TLV Stream Hex String>
    [expires_at]: <Invoice Expires At ISO 8601 Date String>
    [features]: [{
      bit: <BOLT 09 Feature Bit Number>
    }]
    [node_id]: <Invoice Signing Node Public Key Hex String>
    paths: [<Blinded Payment Path Object>]
    [secret]: <Invoice Signing Node Secret Key Hex String>
  }

  @returns
  {
    encoded: <Signed Invoice TLV Stream Hex String>
    invoice: <BOLT 12 Invoice String>
  }
*/
module.exports = args => {
  const unsigned = createUnsignedInvoice({
    created_at: args.created_at,
    encoded: args.encoded,
    expires_at: args.expires_at,
    features: args.features,
    id: sha256(args.encoded),
    node_id: args.node_id,
    paths: args.paths,
  })
  .encoded;

  return createSignedInvoice({
    encoded: unsigned,
    secret: args.secret || issuerSecret,
  });
};
