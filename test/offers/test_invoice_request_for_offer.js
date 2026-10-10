const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {parseInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const method = require('./../../offers/invoice_request_for_offer');

const bufferAsHex = buffer => buffer.toString('hex');
const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const node = asKey(9);
const secret = bufferAsHex(Buffer.alloc(32, 4));

const blinded = blindedPathFromHops({hops: [node]});
const {key} = blinded;
const paths = [{key, hops: blinded.path, introduction_node: node}];

// Make an offer of the issuer of secret 1 with blinded paths
const makeOffer = args => createOffer({
  paths,
  issuer_id: asKey(1),
  networks: ['regtest'],
  ...args,
})
.offer;

// An offer without an amount, and one with an amount
const amountless = makeOffer({});
const priced = makeOffer({description: 'thing', mtokens: '5000'});

// Make a request for an offer and read it back
const make = args => {
  const {encoded, mtokens, paths, payer_id} = method(args);

  const request = parseInvoiceRequest({encoded});

  return {
    mtokens,
    paths,
    payer_id,
    request: {
      bip353_name: request.bip353_name,
      mtokens: request.mtokens,
      offer: request.offer,
      payer_id: request.payer_id,
      payer_note: request.payer_note,
    },
  };
};

// Make two requests for an offer and see if they have the same payer id
const makeTwo = args => {
  return {is_same_payer_id: method(args).payer_id === method(args).payer_id};
};

// Make a request for an offer and see if the payer secret is the payer key
const makeWithSecret = args => {
  const {payer_id, payer_secret} = method(args);

  const payerKey = keyOf(hexAsBuffer(payer_secret));

  return {
    is_payer_key: bufferAsHex(payerKey) === payer_id,
    is_secret: payer_secret === args.secret,
  };
};

// A request for an offer by the payer of secret 4
const requested = ({bip353_name, mtokens, offer, payer_note}) => ({
  mtokens,
  paths,
  payer_id: asKey(4),
  request: {bip353_name, mtokens, offer, payer_note, payer_id: asKey(4)},
});

const tests = [
  {
    args: {secret, mtokens: '250000', network: 'regtest', offer: amountless},
    description: 'An offer without an amount is paid the chosen amount',
    expected: requested({mtokens: '250000', offer: amountless}),
    method: make,
  },
  {
    args: {mtokens: '1000', network: 'regtest', offer: amountless},
    description: 'Each request has its own payer key by default',
    expected: {is_same_payer_id: false},
    method: makeTwo,
  },
  {
    args: {secret, mtokens: '1000', network: 'regtest', offer: amountless},
    description: 'A request has the secret of the payer that was given',
    expected: {is_payer_key: true, is_secret: true},
    method: makeWithSecret,
  },
  {
    args: {mtokens: '1000', network: 'regtest', offer: amountless},
    description: 'A request has the secret of a random payer key by default',
    expected: {is_payer_key: true, is_secret: false},
    method: makeWithSecret,
  },
  {
    args: {
      secret,
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
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
      secret,
      bip353_name: 'alice@example.com',
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
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
    },
    description: 'A name that the offer was found with is user at domain',
    error: 'ExpectedUserAtDomainBip353NameToPayOffer',
    method: make,
  },
  {
    args: {secret, network: 'regtest', offer: priced},
    description: 'An offer with an amount is paid its amount',
    expected: requested({mtokens: '5000', offer: priced}),
    method: make,
  },
  {
    args: {secret, mtokens: '6000', network: 'regtest', offer: priced},
    description: 'An offer with an amount can be paid more than its amount',
    expected: requested({mtokens: '6000', offer: priced}),
    method: make,
  },
  {
    args: {mtokens: '4000', network: 'regtest', offer: priced},
    description: 'An offer with an amount is paid at least its amount',
    error: 'ExpectedAtLeastOfferAmountToPayOffer',
    method: make,
  },
  {
    args: {network: 'regtest', offer: amountless},
    description: 'An offer without an amount is paid a chosen amount',
    error: 'ExpectedMillitokensToPayOfferWithoutAmount',
    method: make,
  },
  {
    args: {mtokens: '0', network: 'regtest', offer: amountless},
    description: 'An amount is positive',
    error: 'ExpectedPositiveMillitokensToPayOffer',
    method: make,
  },
  {
    args: {mtokens: '1000', network: 'testnet', offer: amountless},
    description: 'An offer is paid on its network',
    error: 'ExpectedOfferForNetworkToPay',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: makeOffer({expires_at: '2025-01-01T00:00:00.000Z'}),
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
    },
    description: 'An offer with a quantity is not paid',
    error: 'ExpectedOfferWithoutQuantityToPay',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: createOffer({issuer_id: asKey(1), networks: ['regtest']}).offer,
    },
    description: 'An offer without paths is not paid',
    error: 'ExpectedOfferWithPathsToPay',
    method: make,
  },
  {
    args: {mtokens: '1000', network: 'regtest', offer: 'lno1'},
    description: 'An offer is expected',
    error: 'ExpectedValidOfferToPay',
    method: make,
  },
  {
    args: {mtokens: '1000', offer: amountless},
    description: 'A network is expected',
    error: 'ExpectedNetworkToPayOffer',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      secret: '00',
    },
    description: 'A payer secret is a key',
    error: 'ExpectedPayerSecretKeyToPayOffer',
    method: make,
  },
  {
    args: {
      mtokens: '1000',
      network: 'regtest',
      offer: amountless,
      secret: 'ff'.repeat(32),
    },
    description: 'A payer secret is in the range of private keys',
    error: 'ExpectedValidPayerSecretKeyToPayOffer',
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
