const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {addInvoiceError} = require('./fixtures/serve_support_offer');
const {asExpired} = require('./fixtures/serve_support_offer');
const {asKey} = require('./fixtures/serve_support_offer');
const {episode} = require('./fixtures/service_support_offer');
const {expired} = require('./fixtures/service_support_offer');
const {expiring} = require('./fixtures/service_support_offer');
const {idle} = require('./fixtures/serve_support_offer');
const {invoiceId} = require('./fixtures/serve_support_offer');
const {makeAmountlessRequest} = require('./fixtures/serve_support_offer');
const {makeOffer} = require('./fixtures/service_support_offer');
const {makeReceived} = require('./fixtures/serve_support_offer');
const {makeReceivedOver} = require('./fixtures/serve_support_offer');
const {makeRequest} = require('./fixtures/service_support_offer');
const {payerNote} = require('./fixtures/serve_support_offer');
const {payerOffer} = require('./fixtures/serve_support_offer');
const {plain} = require('./fixtures/service_support_offer');
const {request} = require('./fixtures/service_support_offer');
const {requested} = require('./fixtures/serve_support_offer');
const {sentInvoice} = require('./fixtures/serve_support_offer');
const {serve} = require('./fixtures/serve_support_offer');
const {zeroAmount} = require('./fixtures/serve_support_offer');

const addInvoiceFailure = [503, 'FailedToCreateInvoiceForSupporter'];
const identity = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const listenerFailed = [500, 'UnexpectedErrorInListener'];
const peer = '02989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f';
const signingFailed = 'UnexpectedErrorWhenSigningBytes';

const tests = [
  {
    args: {
      steps: [{received: [makeReceived(request), makeReceived(request)]}],
    },
    description: 'A request that is sent again shares the same invoice',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError, addInvoiceError],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {steps: [{received: [makeReceived(makeAmountlessRequest())]}]},
    description: 'A request without an amount is sent an error',
    expected: {
      ...idle,
      invoice_errors: [[
        '82',
        'ExpectedAmountInInvoiceRequestForOfferWithoutAmount',
        undefined,
      ]],
      replies: [1366],
    },
  },
  {
    args: {
      is_paying: true,
      is_stopping_on_invoice: true,
      steps: [{}, {received: [makeReceived(request)]}],
    },
    description: 'A request being handled when the service stops gets nothing',
    expected: {...idle, invoices: 1},
  },
  {
    args: {steps: [{received: [makeReceived(request, 20)]}]},
    description: 'An error that does not fit in the reply is not sent',
    expected: {...idle, errors: [[503, 'ErrorSendingInvoiceError']]},
  },
  {
    args: {
      is_paying: true,
      steps: [{
        received: [makeReceivedOver({hops: [identity, peer], value: request})],
      }],
    },
    description: 'A reply path that starts at the server is sent to its peer',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
    },
  },
  {
    args: {
      is_paying: true,
      signs: 1,
      steps: [{}, {received: [makeReceived(request)]}],
    },
    description: 'A request gets an error when its invoice cannot be signed',
    expected: {
      ...idle,
      errors: [[503, 'FailedToSignInvoiceForSupporter']],
      invoice_errors: [[undefined, signingFailed, asKey(2)]],
      invoices: 1,
      replies: [1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(25000)]})),
          makeReceived(makeRequest({
            records: [payerNote(25000), payerOffer(10)],
          })),
        ],
      }],
    },
    description: 'A request too large for its invoice is sent an error',
    expected: {
      ...idle,
      invoice_errors: [
        ['2000805807', 'PayerOfferTooLarge', asKey(2)],
        [undefined, 'InvoiceRequestTooLarge', asKey(2)],
      ],
      replies: [1366, 1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(1200)]})),
          makeReceived(makeRequest({
            records: [payerNote(1200), payerOffer(10)],
          })),
        ],
      }],
    },
    description: 'A reply is not larger than its request',
    expected: {
      ...idle,
      invoice_errors: [
        [undefined, 'InvoiceTooLarge', asKey(2)],
        [undefined, 'InvoiceTooLarge', asKey(2)],
      ],
      replies: [1366, 1366],
    },
  },
  {
    args: {
      is_paying: true,
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(800)]})),
          makeReceived(makeRequest({payer: 3, records: [payerNote(800)]})),
        ],
      }],
    },
    description: 'The payer offer is named when the invoice fits without it',
    expected: {
      ...idle,
      invoice_errors: [
        ['2000805807', 'PayerOfferTooLarge', asKey(2)],
        [undefined, 'InvoiceTooLarge', asKey(3)],
      ],
      invoices: 2,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(1200)]}), 1, true),
        ],
      }],
    },
    description: 'A large request can have a large invoice',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError],
      invoices: 1,
      replies: [1366],
    },
  },
  {
    args: {
      related: [{offer: episode}],
      steps: [{received: [makeReceived(makeRequest({to: plain}))]}],
    },
    description: 'An offer of the issuer that is not related is not answered',
    expected: {
      ...idle,
      invoice_errors: [
        [undefined, 'UnknownOfferForInvoiceRequest', asKey(2)],
      ],
      replies: [1366],
    },
  },
  {
    args: {
      related: [{offer: makeOffer({description: 'tip', issuer_id: asKey(6)})}],
      steps: [{
        received: [
          makeReceived(makeRequest({
            to: makeOffer({description: 'tip', issuer_id: asKey(6)}),
          })),
        ],
      }],
    },
    description: 'An offer of another issuer is not answered on these paths',
    expected: {
      ...idle,
      invoice_errors: [
        [undefined, 'UnknownOfferForInvoiceRequest', asKey(2)],
      ],
      replies: [1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(request),
          makeReceived(makeRequest({records: [payerNote(5)]})),
        ],
      }],
    },
    description: 'Requests that are not the same do not share an invoice',
    expected: {
      ...idle,
      errors: [addInvoiceFailure, addInvoiceFailure],
      invoice_errors: [addInvoiceError, addInvoiceError],
      invoices: 2,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      related: [{offer: expired}],
      steps: [{
        received: [makeReceived(asExpired(makeRequest({to: expiring})))],
      }],
    },
    description: 'A request for an offer that has expired is sent an error',
    expected: {
      ...idle,
      invoice_errors: [[undefined, 'OfferExpired', asKey(2)]],
      replies: [1366],
    },
  },
  {
    args: {is_paying: true, steps: requested},
    description: 'A request to pay is sent an invoice',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
    },
  },
  {
    args: {
      is_paying: true,
      steps: [
        {received: [makeReceived(request)]},
        {received: [makeReceived(request)]},
      ],
    },
    description: 'A request that is sent again is sent the same invoice',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, is_repeat: true}],
      signatures: 2,
    },
  },
  {
    args: {
      is_paying: true,
      steps: [{received: [makeReceived(request), makeReceived(request)]}],
    },
    description: 'Requests sent together share the invoice being made',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, is_repeat: true}],
      signatures: 2,
    },
  },
  {
    args: {is_paying: true, steps: requested, support_note: 'Thank you!'},
    description: 'An invoice has the support note',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [{...sentInvoice, note: 'Thank you!'}],
      signatures: 2,
    },
  },
  {
    args: {is_paying: true, steps: [...requested, {paid: [1]}]},
    description: 'A supporter has paid when the invoice is paid',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
      supporters: [[invoiceId(1), '1000', asKey(2)]],
    },
  },
  {
    args: {
      is_paying: true,
      steps: [...requested, {paid: [1]}, {received: [makeReceived(request)]}],
      throwing: ['invoice', 'supporter'],
    },
    description: 'A listener that throws does not end the service',
    expected: {
      ...idle,
      errors: [listenerFailed, listenerFailed, listenerFailed],
      invoices: 2,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, id: invoiceId(2)}],
      signatures: 3,
      supporters: [[invoiceId(1), '1000', asKey(2)]],
    },
  },
  {
    args: {
      is_paying: true,
      steps: [
        ...requested,
        {is_failing: true, paid: [1]},
        {received: [makeReceived(makeRequest({payer: 3}))]},
      ],
    },
    description: 'The service gets through a disconnection from LND',
    expected: {
      ...idle,
      errors: [[503, 'NetworkMessagesSubscriptionFailed']],
      invoices: 2,
      replies: [1366, 1366],
      sent: [
        sentInvoice,
        {...sentInvoice, id: invoiceId(2), payer_id: asKey(3)},
      ],
      signatures: 3,
      supporters: [[invoiceId(1), '1000', asKey(2)]],
    },
  },
  {
    args: {
      is_paying: true,
      steps: [...requested, {is_failing: true}, ...requested],
    },
    description: 'A request sent again after a disconnection gets its invoice',
    expected: {
      ...idle,
      errors: [[503, 'NetworkMessagesSubscriptionFailed']],
      invoices: 1,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, is_repeat: true}],
      signatures: 2,
    },
  },
  {
    args: {
      steps: [{received: [makeReceived(makeRequest({mtokens: '0'}))]}],
      throwing: ['error', 'invoice_error'],
    },
    description: 'An error listener that throws does not end the service',
    expected: {
      ...idle,
      errors: [listenerFailed],
      invoice_errors: [zeroAmount],
      replies: [1366],
    },
  },
  {
    args: {steps: [{received: [makeReceived(makeRequest({mtokens: '0'}))]}]},
    description: 'A request to pay an amount of zero is sent an error',
    expected: {...idle, invoice_errors: [zeroAmount], replies: [1366]},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, async () => {
    deepStrictEqual(await serve(args), expected, 'Got expected result');
  });
});
