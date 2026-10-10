const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {isPrivate} = require('tiny-secp256k1');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const randomSecret = require('./random_secret');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isMtokens = n => typeof n === 'string' && /^[1-9]\d*$/.test(n);
const isName = n => typeof n === 'string' && namePattern.test(n);
const isSecret = n => typeof n === 'string' && /^[0-9a-f]{64}$/i.test(n);
const namePattern = /^[0-9a-zA-Z\-_.]+@[0-9a-zA-Z\-_.]+$/;

/** Make a signed BOLT 12 invoice request, with a random payer key by default

  Give the `bip353_name` that the offer was found with, as BOLT 12 requires,
  so that the recipient knows which name was used

  {
    [bip353_name]: <BIP 353 Human Readable Name Offer Was Found With String>
    [mtokens]: <Millitokens to Pay String>
    network: <Network Name String>
    offer: <BOLT 12 Offer String>
    [payer_note]: <Payer Note String>
    [secret]: <Payer Secret Key Hex String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Signed Invoice Request TLV Stream Hex String>
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
    payer_id: <Payer Public Key Hex String>
    payer_secret: <Payer Secret Key Hex String>
    request: <BOLT 12 Invoice Request String>
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

  if (args.secret !== undefined && !isSecret(args.secret)) {
    throw new Error('ExpectedPayerSecretKeyToPayOffer');
  }

  // A secret that is out of the range of private keys has no public key
  if (args.secret !== undefined && !isPrivate(hexAsBuffer(args.secret))) {
    throw new Error('ExpectedValidPayerSecretKeyToPayOffer');
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

  // Requests are sent over the blinded paths of the offer
  if (!details.paths || !details.paths.length) {
    throw new Error('ExpectedOfferWithPathsToPay');
  }

  // An amount in a currency is converted to millitokens by the payer
  if (!!details.currency && !args.mtokens) {
    throw new Error('ExpectedMillitokensToPayOfferWithCurrencyAmount');
  }

  const amount = args.mtokens || details.mtokens;

  // An offer without an amount is paid the amount the payer chooses
  if (!amount) {
    throw new Error('ExpectedMillitokensToPayOfferWithoutAmount');
  }

  const hasOfferAmount = !details.currency && !!details.mtokens;

  // An offer with an amount is paid at least that amount
  if (hasOfferAmount && BigInt(amount) < BigInt(details.mtokens)) {
    throw new Error('ExpectedAtLeastOfferAmountToPayOffer');
  }

  const payerSecret = args.secret || randomSecret().secret;

  const payerId = pointFromScalar(hexAsBuffer(payerSecret));

  const payer = bufferAsHex(Buffer.from(payerId));

  const unsigned = createUnsignedInvoiceRequest({
    bip353_name: args.bip353_name,
    mtokens: amount,
    network: args.network,
    offer: args.offer,
    payer_id: payer,
    payer_note: args.payer_note,
  });

  const signed = createSignedInvoiceRequest({
    encoded: unsigned.encoded,
    secret: payerSecret,
  });

  return {
    encoded: signed.encoded,
    mtokens: amount,
    paths: details.paths,
    payer_id: payer,
    payer_secret: payerSecret,
    request: signed.request,
  };
};
