const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {pointFromScalar} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../service_records');
const method = require('./../../support/invoice_paths_to_fit');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');

const node = asKey(9);
const blinded = blindedPathFromHops({hops: [node]});

const offer = addServiceLabel({
  id: '0d'.repeat(16),
  offer: createOffer({
    description: 'support',
    issuer_id: asKey(1),
    paths: [{hops: blinded.path, introduction_node: node, key: blinded.key}],
  })
  .offer,
  type: '1',
  version: 1,
})
.offer;

// A blinded payment path of two hops
const paymentPath = n => ({
  base_fee_mtokens: '1000',
  cltv_delta: 80,
  fee_rate: 1000,
  hops: [
    {encrypted_data: '01'.repeat(50), relay_key: asKey(n)},
    {encrypted_data: '02'.repeat(62), relay_key: asKey(n + 1)},
  ],
  introduction_node: asKey(n + 2),
  key: asKey(n + 3),
  max_htlc_mtokens: '990000000',
  min_htlc_mtokens: '1000',
});

const paths = [paymentPath(10), paymentPath(20), paymentPath(30)];

const invoice = {
  created_at: '2026-10-01T00:00:00.000Z',
  expires_at: '2026-10-01T01:00:00.000Z',
  id: '03'.repeat(32),
  mtokens: '1000',
};

// Make a request to pay the offer with a payer offer record of a size
const makeRequest = bytes => {
  const unsigned = createUnsignedInvoiceRequest({
    offer,
    mtokens: '1000',
    payer_id: asKey(4),
  });

  const {records} = decodeTlvStream({encoded: unsigned.encoded});

  // A payer offer record of a number of bytes
  const payerOffer = {
    type: '2000805807',
    value: encodeTlvStream({records: [{type: '1', value: '00'.repeat(bytes)}]})
      .encoded,
  };

  const extra = !bytes ? [] : [payerOffer];

  const {encoded} = encodeTlvStream({
    records: records.map(({type, value}) => ({type, value})).concat(extra),
  });

  return createSignedInvoiceRequest({
    encoded,
    secret: Buffer.alloc(32, 4).toString('hex'),
  });
};

const request = makeRequest();

// A support note sealed with a note of 112 bytes
const note = {type: '3000805805', value: '00'.repeat(144)};

// Find how many payment paths fit in an invoice for a request
const fit = args => method({invoice, paths, ...args});

const tests = [
  {
    args: {request, bytes: Infinity},
    description: 'Every payment path fits',
    expected: {count: 3},
  },
  {
    args: {request, bytes: 1100},
    description: 'An invoice has as many payment paths as fit',
    expected: {count: 2},
  },
  {
    args: {request, bytes: 900},
    description: 'An invoice can have one payment path',
    expected: {count: 1},
  },
  {
    args: {request, bytes: 400},
    description: 'No path fits, and there is no payer offer',
    expected: {is_payer_offer_too_large: false},
  },
  {
    args: {bytes: 900, request: makeRequest(300)},
    description: 'A payer offer is too large when the invoice fits without it',
    expected: {is_payer_offer_too_large: true},
  },
  {
    args: {bytes: 400, request: makeRequest(300)},
    description: 'A payer offer is not too large when nothing would fit',
    expected: {is_payer_offer_too_large: false},
  },
  {
    args: {request, bytes: 1100, records: [note]},
    description: 'Records like a support note are counted in the size',
    expected: {count: 1},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(fit(args), expected, 'Got expected result');
  });
});
