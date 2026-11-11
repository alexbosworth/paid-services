const {createHash} = require('node:crypto');
const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {createSignedInvoiceRequest} = require('invoices');
const {isPoint} = require('tiny-secp256k1');
const {parseInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const {amountless} = require('./fixtures/invoice_request_for_offer');
const {currency} = require('./fixtures/invoice_request_for_offer');
const {issuerOnly} = require('./fixtures/invoice_request_for_offer');
const {makeOffer} = require('./fixtures/invoice_request_for_offer');
const method = require('./../../offers/invoice_request_for_offer');
const {paths} = require('./fixtures/invoice_request_for_offer');
const {priced} = require('./fixtures/invoice_request_for_offer');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const payerId = '03462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b';
const secret = Buffer.alloc(32, 4);
const sha256 = n => createHash('sha256').update(n).digest();

// Get the public key of a secret of 32 bytes of a number
const asKey = n => {
  return Buffer.from(pointFromScalar(Buffer.alloc(32, n))).toString('hex');
};

// The tagged hash of a preimage
const taggedHash = (tag, hex) => {
  const tagHash = sha256(Buffer.from(tag));

  return sha256(Buffer.concat([tagHash, tagHash, hexAsBuffer(hex)]));
};

// Sign a request by its root and tag with the secret of the payer id
const sign = ({encoded, root, tag}) => {
  const signature = signSchnorr(taggedHash(tag, root), secret);

  return createSignedInvoiceRequest({
    encoded,
    signature: bufferAsHex(Buffer.from(signature)),
  });
};

// Make a request for an offer, sign it, and read it back
const make = args => {
  const {description, encoded, mtokens, paths, root, tag} = method(args);

  const signed = sign({encoded, root, tag});

  const request = parseInvoiceRequest({encoded: signed.encoded});

  return {
    description,
    mtokens,
    paths,
    request: {
      bip353_name: request.bip353_name,
      mtokens: request.mtokens,
      offer: request.offer,
      payer_id: request.payer_id,
      payer_note: request.payer_note,
    },
  };
};

// Make a request for an offer without paths and look at the path to send over
const sendOver = args => {
  const {paths} = method(args);

  const [path] = paths;

  return {
    hops: path.hops.length,
    introduction_node: path.introduction_node,
    is_blinded: path.hops.every(hop => isPoint(hexAsBuffer(hop.relay_key))),
    is_keyed: isPoint(hexAsBuffer(path.key)),
    paths: paths.length,
  };
};

// A request for an offer by the payer of secret 4
const requested = args => ({
  paths,
  description: args.description,
  mtokens: args.mtokens,
  request: {
    bip353_name: args.bip353_name,
    mtokens: args.mtokens,
    offer: args.offer,
    payer_id: payerId,
    payer_note: args.payer_note,
  },
});

const tests = [
  {
    args: {
      mtokens: '250000',
      network: 'regtest',
      offer: amountless,
      payer_id: payerId,
    },
    description: 'An offer without an amount is paid the chosen amount',
    expected: requested({mtokens: '250000', offer: amountless}),
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      payer_id: payerId,
      payer_note: 'thanks',
    },
    description: 'A request can have a payer note',
    expected: requested({
      mtokens: '1000',
      offer: amountless,
      payer_note: 'thanks',
    }),
    method: make,
  },
  {
    args: {
      bip353_name: 'alice@example.com',
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      payer_id: payerId,
    },
    description: 'A request has the name that the offer was found with',
    expected: requested({
      bip353_name: 'alice@example.com',
      mtokens: '1000',
      offer: amountless,
    }),
    method: make,
  },
  {
    args: {
      bip353_name: 'alice',
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      payer_id: payerId,
    },
    description: 'A name that the offer was found with is user at domain',
    error: 'ExpectedUserAtDomainBip353NameToPayOffer',
    method: make,
  },
  {
    args: {network: 'regtest', offer: priced, payer_id: payerId},
    description: 'An offer with an amount is paid its amount',
    expected: requested({
      description: 'thing',
      mtokens: '5000',
      offer: priced,
    }),
    method: make,
  },
  {
    args: {
      mtokens: '6000',
      network: 'regtest',
      offer: priced,
      payer_id: payerId,
    },
    description: 'An offer with an amount can be paid more than its amount',
    expected: requested({
      description: 'thing',
      mtokens: '6000',
      offer: priced,
    }),
    method: make,
  },
  {
    args: {
      mtokens: '4000',
      network: 'regtest',
      offer: priced,
      payer_id: payerId,
    },
    description: 'An offer with an amount is paid at least its amount',
    error: 'ExpectedAtLeastOfferAmountToPayOffer',
    method: make,
  },
  {
    args: {network: 'regtest', offer: amountless, payer_id: payerId},
    description: 'An offer without an amount is paid a chosen amount',
    error: 'ExpectedMillitokensToPayOfferWithoutAmount',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: currency,
      payer_id: payerId,
    },
    description: 'An offer with an amount in a currency is not paid',
    error: 'UnsupportedCurrencyAmountInOfferToPay',
    method: make,
  },
  {
    args: {
      mtokens: '0',
      network: 'regtest',
      offer: amountless,
      payer_id: payerId,
    },
    description: 'An amount is positive',
    error: 'ExpectedPositiveMillitokensToPayOffer',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'testnet',
      offer: amountless,
      payer_id: payerId,
    },
    description: 'An offer is paid on its network',
    error: 'ExpectedOfferForNetworkToPay',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: makeOffer({expires_at: '2025-01-01T00:00:00.000Z'}),
      payer_id: payerId,
    },
    description: 'An offer that has expired is not paid',
    error: 'ExpectedUnexpiredOfferToPay',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: makeOffer({max_quantity: 2}),
      payer_id: payerId,
    },
    description: 'An offer with a quantity is not paid',
    error: 'ExpectedOfferWithoutQuantityToPay',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: issuerOnly.offer,
      payer_id: payerId,
    },
    description: 'An offer without paths is requested at its issuer id',
    expected: {
      hops: 1,
      introduction_node: asKey(1),
      is_blinded: true,
      is_keyed: true,
      paths: 1,
    },
    method: sendOver,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: 'lno1',
      payer_id: payerId,
    },
    description: 'An offer is expected',
    error: 'ExpectedValidOfferToPay',
    method: make,
  },
  {
    args: {mtokens: '1000', offer: amountless, payer_id: payerId},
    description: 'A network is expected',
    error: 'ExpectedNetworkToPayOffer',
    method: make,
  },
  {
    args: {mtokens: '1000', network: 'regtest', offer: amountless},
    description: 'A payer id is expected',
    error: 'ExpectedPayerIdPublicKeyToPayOffer',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      payer_id: '00',
    },
    description: 'A payer id is a public key',
    error: 'ExpectedPayerIdPublicKeyToPayOffer',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      payer_id: `02${'ff'.repeat(32)}`,
    },
    description: 'A payer id is a point on the curve',
    error: 'ExpectedPayerIdPublicKeyToPayOffer',
    method: make,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
