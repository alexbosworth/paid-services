const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {isPrivate} = require('tiny-secp256k1');
const {pointFromScalar} = require('tiny-secp256k1');

const {menuRequestMtokens} = require('./constants');
const {numberAsTruncated} = require('./../service_records');
const randomSecret = require('./../offers/random_secret');
const {typeMenuRequest} = require('./constants');
const {typeMenuRequestPage} = require('./constants');

const {isSafeInteger} = Number;
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const byType = (a, b) => BigInt(a.type) < BigInt(b.type) ? -1 : 1;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const isPage = n => n === undefined || (isSafeInteger(n) && n >= 0);
const isSecret = n => isHex(n) && isPrivate(hexAsBuffer(n));

/** Create a signed invoice request that asks for a page of the menu of an
  offer

  The request has a new payer id and random metadata, and an amount of 1000
  that is not used. The first page is asked for when `page` is left out.
  Give the `bip353_name` that the offer was found with, as BOLT 12 requires.
  A `metadata` and `secret` are only for making test vectors.

  {
    [bip353_name]: <BIP 353 Human Readable Name String>
    [metadata]: <Invoice Request Metadata Hex String>
    offer: <BOLT 12 Offer String>
    [page]: <Menu Page Number Number>
    [secret]: <Payer Id Private Key Hex String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Signed Invoice Request TLV Stream Hex String>
    payer_id: <Payer Id Public Key Hex String>
  }
*/
module.exports = args => {
  if (!!args.secret && !isSecret(args.secret)) {
    throw new Error('ExpectedPrivateKeyToCreateMenuRequest');
  }

  if (!isPage(args.page)) {
    throw new Error('ExpectedPageNumberToCreateMenuRequest');
  }

  const payerSecret = args.secret || randomSecret().secret;

  const payerId = bufferAsHex(pointFromScalar(hexAsBuffer(payerSecret)));

  const unsigned = createUnsignedInvoiceRequest({
    bip353_name: args.bip353_name,
    metadata: args.metadata,
    mtokens: menuRequestMtokens,
    offer: args.offer,
    payer_id: payerId,
  });

  const {records} = decodeTlvStream({encoded: unsigned.encoded});

  // A page other than the first is asked for with its page number
  const pageOption = () => ({
    type: typeMenuRequestPage,
    value: numberAsTruncated({number: String(args.page)}).encoded,
  });

  // The menu request record is a TLV stream of options, like the page number
  const options = !args.page ? [] : [pageOption()];

  const menuRequest = {
    type: typeMenuRequest,
    value: encodeTlvStream({records: options}).encoded,
  };

  const {encoded} = encodeTlvStream({
    records: records.concat(menuRequest).sort(byType),
  });

  const signed = createSignedInvoiceRequest({encoded, secret: payerSecret});

  return {encoded: signed.encoded, payer_id: payerId};
};
