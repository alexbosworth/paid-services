const {createSignedInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const requestForOffer = require('./../../../offers/invoice_request_for_offer');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const defaultSecret = Buffer.alloc(32, 4);
const keyOf = secret => bufferAsHex(pointFromScalar(secret));

/** Make a signed BOLT 12 invoice request for an offer, by the payer of
  secret 4 by default

  {
    [bip353_name]: <BIP 353 Human Readable Name Offer Was Found With String>
    [mtokens]: <Millitokens to Pay String>
    network: <Network Name String>
    offer: <BOLT 12 Offer String>
    [payer_note]: <Payer Note String>
    [secret]: <Payer Secret Key Buffer Object>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Signed Invoice Request TLV Stream Hex String>
    mtokens: <Requested Millitokens String>
    payer_id: <Payer Public Key Hex String>
    request: <BOLT 12 Invoice Request String>
  }
*/
module.exports = args => {
  const secret = args.secret || defaultSecret;

  const unsigned = requestForOffer({
    bip353_name: args.bip353_name,
    mtokens: args.mtokens,
    network: args.network,
    offer: args.offer,
    payer_id: keyOf(secret),
    payer_note: args.payer_note,
  });

  const signed = createSignedInvoiceRequest({
    encoded: unsigned.encoded,
    secret: bufferAsHex(secret),
  });

  return {
    encoded: signed.encoded,
    mtokens: unsigned.mtokens,
    payer_id: keyOf(secret),
    request: signed.request,
  };
};
