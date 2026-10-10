const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./fixtures/make_invoice');
const method = require('./../../offers/pay_offer_invoice');
const requestForOffer = require('./../../offers/invoice_request_for_offer');

const bufferAsHex = buffer => buffer.toString('hex');
const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const node = asKey(9);
const secret = bufferAsHex(Buffer.alloc(32, 4));

const blinded = blindedPathFromHops({hops: [node]});
const {key} = blinded;

const offerPath = {key, hops: blinded.path, introduction_node: node};

// A payment path into the recipient that starts at a node or at an edge
const paymentPath = start => ({
  key,
  base_fee_mtokens: '1',
  cltv_delta: 40,
  fee_rate: 1,
  hops: blinded.path,
  max_htlc_mtokens: '1000000',
  min_htlc_mtokens: '1',
  ...start,
});

// Make an invoice of an offer for a network over payment paths
const makeOfferInvoice = ({created_at, expires_at, network, paths}) => {
  const {encoded} = requestForOffer({
    network,
    secret,
    mtokens: '1000',
    offer: createOffer({
      issuer_id: asKey(1),
      networks: [network],
      paths: [offerPath],
    })
    .offer,
  });

  return makeInvoice({created_at, encoded, expires_at, paths}).invoice;
};

// Make a fake LND that fails to look up channels
const makeTestLnd = () => {
  const lnd = makeLnd({});

  lnd.default.getChanInfo = ({}, cbk) => cbk({details: 'unexpected error'});

  return lnd;
};

const tests = [
  {
    args: {},
    description: 'An invoice is expected',
    error: [400, 'ExpectedInvoiceToPayOfferInvoice'],
  },
  {
    args: {invoice: 'lni1'},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToPayOfferInvoice'],
  },
  {
    args: {invoice: 'lni1', lnd: {}},
    description: 'A max fee is expected',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOfferInvoice'],
  },
  {
    args: {invoice: 'lni1', lnd: {}, max_fee_mtokens: '-1'},
    description: 'A max fee is millitokens',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOfferInvoice'],
  },
  {
    args: {invoice: 'lni1', lnd: {}, max_fee_mtokens: 0},
    description: 'A max fee is a string of millitokens, not a number',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOfferInvoice'],
  },
  {
    args: {invoice: 'lni1', lnd: {}, max_fee_mtokens: ''},
    description: 'A max fee is not empty',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOfferInvoice'],
  },
  {
    args: {invoice: 'lni1', lnd: {}, max_fee_mtokens: '0'},
    description: 'An invoice that cannot be read is not paid',
    error: [400, 'ExpectedValidInvoiceToPay'],
  },
  {
    args: {
      invoice: makeOfferInvoice({
        created_at: '2024-12-31T00:00:00.000Z',
        expires_at: '2025-01-01T00:00:00.000Z',
        network: 'bitcoin',
        paths: [paymentPath({introduction_node: node})],
      }),
      lnd: makeTestLnd(),
      max_fee_mtokens: '0',
    },
    description: 'An invoice that has expired is not paid',
    error: [400, 'ExpectedUnexpiredInvoiceToPay'],
  },
  {
    args: {
      invoice: makeOfferInvoice({
        network: 'regtest',
        paths: [paymentPath({introduction_node: node})],
      }),
      lnd: makeTestLnd(),
      max_fee_mtokens: '0',
    },
    description: 'An invoice is paid on the network of the node',
    error: [400, 'ExpectedInvoiceForNodeNetworkToPay'],
  },
  {
    args: {
      invoice: makeOfferInvoice({
        network: 'bitcoin',
        paths: [paymentPath({introduction_edge: '0x0x1x0'})],
      }),
      lnd: makeTestLnd(),
      max_fee_mtokens: '0',
    },
    description: 'An invoice without paths that can be resolved is not paid',
    error: [503, 'FailedToFindStartOfOfferInvoicePaymentPaths'],
  },
];

tests.forEach(({args, description, error}) => {
  test(description, async () => {
    await rejects(method(args), error, 'Got error');
  });
});
