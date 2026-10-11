const {createUnsignedInvoiceRequest} = require('invoices');
const {isPoint} = require('tiny-secp256k1');
const {parseOffer} = require('invoices');

const issuerPath = require('./issuer_path');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const isKey = n => isHex(n) && n.length === 66 && isPoint(hexAsBuffer(n));
const isMtokens = n => typeof n === 'string' && /^[1-9]\d*$/.test(n);
const isName = n => typeof n === 'string' && namePattern.test(n);
const namePattern = /^[0-9a-zA-Z\-_.]+@[0-9a-zA-Z\-_.]+$/;

/** Make an unsigned BOLT 12 invoice request for an offer, with a payer id

  `mtokens` defaults to the offer amount, and is required when the offer has
  no amount. An offer with an amount in a currency is not supported.

  Give the `bip353_name` that the offer was found with, as BOLT 12 requires,
  so that the recipient knows which name was used

  Sign `root` with `tag` as the tagged hash tag, with the key of `payer_id`,
  and give the signature to `createSignedInvoiceRequest` to finish the request

  The request is sent over the `paths`: the paths of the offer, or a path to
  the issuer id of an offer that has no paths, as BOLT 12 requires

  {
    [bip353_name]: <BIP 353 Human Readable Name Offer Was Found With String>
    [mtokens]: <Millitokens to Pay String>
    network: <Network Name String>
    offer: <BOLT 12 Offer String>
    payer_id: <Payer Public Key Hex String>
    [payer_note]: <Payer Note String>
  }

  @throws
  <Error>

  @returns
  {
    [description]: <Offer Description String>
    encoded: <Unsigned Invoice Request TLV Stream Hex String>
    mtokens: <Requested Millitokens String>
    paths: [{
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
    }]
    root: <Merkle Root Hash To Sign Hex String>
    tag: <Signature Tagged Hash Tag String>
  }
*/
module.exports = args => {
  if (args.bip353_name !== undefined && !isName(args.bip353_name)) {
    throw new Error('ExpectedUserAtDomainBip353NameToPayOffer');
  }

  if (args.mtokens !== undefined && !isMtokens(args.mtokens)) {
    throw new Error('ExpectedPositiveMillitokensToPayOffer');
  }

  if (!args.network) {
    throw new Error('ExpectedNetworkToPayOffer');
  }

  if (!isKey(args.payer_id)) {
    throw new Error('ExpectedPayerIdPublicKeyToPayOffer');
  }

  // Exit early when the offer cannot be read
  try {
    parseOffer({offer: args.offer});
  } catch (err) {
    throw new Error('ExpectedValidOfferToPay');
  }

  const details = parseOffer({offer: args.offer});

  if (details.is_expired) {
    throw new Error('ExpectedUnexpiredOfferToPay');
  }

  if (!details.networks.includes(args.network)) {
    throw new Error('ExpectedOfferForNetworkToPay');
  }

  // Requests for a quantity are not supported
  if (details.max_quantity !== undefined) {
    throw new Error('ExpectedOfferWithoutQuantityToPay');
  }

  // An amount in a currency needs an exchange rate, which is not supported
  if (!!details.currency) {
    throw new Error('UnsupportedCurrencyAmountInOfferToPay');
  }

  const amount = args.mtokens || details.mtokens;

  // An offer without an amount is paid the amount the payer chooses
  if (!amount) {
    throw new Error('ExpectedMillitokensToPayOfferWithoutAmount');
  }

  // An offer with an amount is paid at least that amount
  if (!!details.mtokens && BigInt(amount) < BigInt(details.mtokens)) {
    throw new Error('ExpectedAtLeastOfferAmountToPayOffer');
  }

  // A request is sent over the offer paths, or to the issuer id without them
  const paths = details.paths || [issuerPath({id: details.issuer_id})];

  const unsigned = createUnsignedInvoiceRequest({
    bip353_name: args.bip353_name,
    mtokens: amount,
    network: args.network,
    offer: args.offer,
    payer_id: args.payer_id,
    payer_note: args.payer_note,
  });

  return {
    paths,
    description: details.description,
    encoded: unsigned.encoded,
    mtokens: amount,
    root: unsigned.root,
    tag: unsigned.tag,
  };
};
