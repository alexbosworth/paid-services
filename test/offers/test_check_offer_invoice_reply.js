const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./fixtures/make_invoice');
const makeRequest = require('./fixtures/make_request');
const method = require('./../../offers/check_offer_invoice_reply');

const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));
const bufferAsHex = buffer => buffer.toString('hex');
const createdAt = '2025-01-01T00:00:00.000Z';
const expiresAt = '2100-01-01T00:00:00.000Z';
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const mtokens = '1000';
const node = asKey(9);
const sha256 = n => createHash('sha256').update(n).digest('hex');

const blinded = blindedPathFromHops({hops: [node]});

// The path of the offer, that requests are sent over
const path = {hops: blinded.path, introduction_node: node, key: blinded.key};

// The offer of the issuer of secret 1
const offer = createOffer({
  issuer_id: asKey(1),
  networks: ['bitcoin'],
  paths: [path],
})
.offer;

// A path that ends at the node of a secret, as a path of an offer
const pathTo = n => ({
  hops: [{encrypted_data: '00', relay_key: asKey(n)}],
  introduction_node: node,
  key: asKey(7),
});

// An offer without an issuer id, with paths that end at nodes 5 and 6
const unissued = createOffer({
  networks: ['bitcoin'],
  paths: [pathTo(5), pathTo(6)],
})
.offer;

// A payment path to pay an invoice over
const paymentPath = {
  base_fee_mtokens: '1',
  cltv_delta: 40,
  fee_rate: 1,
  hops: blinded.path,
  introduction_node: node,
  key: blinded.key,
  max_htlc_mtokens: '1000000',
  min_htlc_mtokens: '1',
};

// A request for the offer, and a request for the offer of another amount
const request = makeRequest({mtokens, offer, network: 'bitcoin'});

const other = makeRequest({offer, mtokens: '2000', network: 'bitcoin'});

// An invoice for a request
const invoiceFor = ({encoded}, args) => makeInvoice({
  encoded,
  created_at: createdAt,
  expires_at: expiresAt,
  paths: [paymentPath],
  ...args,
});

const good = invoiceFor(request);

// An invoice for the request that has an invoice feature
const featured = invoiceFor(request, {features: [{bit: 17}]});

// A request for the offer without an issuer id
const unissuedRequest = makeRequest({
  mtokens,
  network: 'bitcoin',
  offer: unissued,
});

// An invoice for the request to the offer without an issuer id, from node 6
const fromNodeSix = invoiceFor(unissuedRequest, {
  node_id: asKey(6),
  secret: bufferAsHex(Buffer.alloc(32, 6)),
});

const tests = [
  {
    args: {path, request, reply: {type: '66', value: good.encoded}},
    description: 'An invoice for the request has its payment paths',
    expected: {
      invoice: {
        mtokens,
        expires_at: expiresAt,
        features: [],
        id: sha256(request.encoded),
        invoice: good.invoice,
        paths: [{...paymentPath, features: [], introduction_edge: undefined}],
      },
    },
  },
  {
    args: {path, request, reply: {type: '66', value: featured.encoded}},
    description: 'An invoice for the request has its features',
    expected: {
      invoice: {
        mtokens,
        expires_at: expiresAt,
        features: [{
          bit: 17,
          is_required: false,
          type: 'multipath_payments_v0',
        }],
        id: sha256(request.encoded),
        invoice: featured.invoice,
        paths: [{...paymentPath, features: [], introduction_edge: undefined}],
      },
    },
  },
  {
    args: {
      path,
      request,
      reply: {
        type: '68',
        value: createInvoiceError({message: 'refused'}).encoded,
      },
    },
    description: 'An invoice error is a failed reply',
    expected: {
      error: [503, 'OfferInvoiceRequestFailed', {
        erroneous_field: undefined,
        message: 'refused',
      }],
    },
  },
  {
    args: {path, request, reply: {type: '68', value: '00'}},
    description: 'An invoice error that cannot be read is a failed reply',
    expected: {error: [503, 'OfferInvoiceRequestFailed', {}]},
  },
  {
    args: {path, request, reply: {type: '66', value: '00'}},
    description: 'An invoice that cannot be read is a failed reply',
    expected: 'ExpectedValidInvoiceForOffer',
  },
  {
    args: {
      path,
      request,
      reply: {type: '66', value: invoiceFor(other).encoded},
    },
    description: 'An invoice for another request is a failed reply',
    expected: 'ExpectedValidInvoiceForOffer',
  },
  {
    args: {
      path: pathTo(6),
      request: unissuedRequest,
      reply: {type: '66', value: fromNodeSix.encoded},
    },
    description: 'An invoice is signed by the end of the path requested over',
    expected: {
      invoice: {
        mtokens,
        expires_at: expiresAt,
        features: [],
        id: sha256(unissuedRequest.encoded),
        invoice: fromNodeSix.invoice,
        paths: [{...paymentPath, features: [], introduction_edge: undefined}],
      },
    },
  },
  {
    args: {
      path: pathTo(5),
      request: unissuedRequest,
      reply: {type: '66', value: fromNodeSix.encoded},
    },
    description: 'An invoice signed by the end of another offer path fails',
    expected: {
      error: [503, 'ExpectedInvoiceSignedByFinalNodeOfOfferPathUsed'],
    },
  },
  {
    args: {
      path,
      request,
      reply: {
        type: '66',
        value: invoiceFor(request, {
          created_at: '2024-12-31T00:00:00.000Z',
          expires_at: createdAt,
        })
        .encoded,
      },
    },
    description: 'An invoice that has expired is a failed reply',
    expected: {error: [503, 'ExpectedUnexpiredInvoiceForOffer']},
  },
  {
    args: {
      path,
      request: {mtokens: '2000', request: request.request},
      reply: {type: '66', value: good.encoded},
    },
    description: 'An invoice for another amount is a failed reply',
    expected: {error: [503, 'ExpectedInvoiceForRequestedAmount']},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    const res = method(args);

    // Invoices that cannot be read are checked by their error message
    if (typeof expected === 'string') {
      const [code, message] = res.error;

      return deepStrictEqual([code, message], [503, expected], 'Got error');
    }

    deepStrictEqual(res, expected, 'Got expected result');
  });
});
