const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {createInvoiceError} = require('invoices');

const {featured} = require('./fixtures/check_offer_invoice_reply');
const {fromNodeSix} = require('./fixtures/check_offer_invoice_reply');
const {good} = require('./fixtures/check_offer_invoice_reply');
const {invoiceFor} = require('./fixtures/check_offer_invoice_reply');
const method = require('./../../offers/check_offer_invoice_reply');
const {other} = require('./fixtures/check_offer_invoice_reply');
const {path} = require('./fixtures/check_offer_invoice_reply');
const {pathTo} = require('./fixtures/check_offer_invoice_reply');
const {paymentPath} = require('./fixtures/check_offer_invoice_reply');
const {request} = require('./fixtures/check_offer_invoice_reply');
const {unissuedRequest} = require('./fixtures/check_offer_invoice_reply');

const createdAt = '2025-01-01T00:00:00.000Z';
const expiresAt = '2100-01-01T00:00:00.000Z';
const mtokens = '1000';
const sha256 = n => createHash('sha256').update(n).digest('hex');

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
