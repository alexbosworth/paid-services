const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {addInvoiceError} = require('./fixtures/serve_support_offer');
const {asKey} = require('./fixtures/serve_support_offer');
const {badMenuRequest} = require('./fixtures/serve_support_offer');
const {firstPage} = require('./fixtures/serve_support_offer');
const {idle} = require('./fixtures/serve_support_offer');
const {makeMenuRequest} = require('./fixtures/serve_support_offer');
const {makeReceived} = require('./fixtures/serve_support_offer');
const {makeRecord} = require('./fixtures/serve_support_offer');
const {makeRequest} = require('./fixtures/service_support_offer');
const {otherMenuRequest} = require('./fixtures/serve_support_offer');
const {request} = require('./fixtures/service_support_offer');
const {serve} = require('./fixtures/serve_support_offer');

const addInvoiceFailure = [503, 'FailedToCreateInvoiceForSupporter'];

const tests = [
  {
    args: {
      record: makeRecord({max_unpaid_invoices_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeRequest({payer: 2})),
          makeReceived(makeRequest({payer: 3})),
        ],
      }],
    },
    description: 'Unpaid invoices are limited',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [
        [undefined, 'TooManyUnpaidInvoices', asKey(3)],
        addInvoiceError,
      ],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeMenuRequest()),
          makeReceived(makeMenuRequest()),
        ],
      }],
    },
    description: 'Requests beyond the requests limit are ignored',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeMenuRequest()),
          makeReceived(makeMenuRequest()),
          makeReceived(request),
        ],
      }],
    },
    description: 'Menu requests and requests to pay are limited apart',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError],
      invoices: 1,
      menus: [firstPage],
      replies: [1366, 1366],
    },
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeRequest({
            payer: 4,
            records: [{type: '2000805805', value: '0200'}],
          })),
          makeReceived(request),
          makeReceived(makeRequest({payer: 3})),
        ],
      }],
    },
    description: 'A menu request that is not understood uses the menu limit',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [
        ['2000805805', 'UnsupportedSupportMenuRequest', asKey(4)],
        addInvoiceError,
      ],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [
        {
          received: [
            makeReceived(otherMenuRequest()),
            makeReceived(makeMenuRequest()),
            makeReceived(request),
          ],
        },
      ],
    },
    description: 'A menu request not replied to uses the menu limit',
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
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [
        {
          received: [
            makeReceived(badMenuRequest(), 9),
            makeReceived(makeMenuRequest()),
          ],
        },
      ],
    },
    description: 'A menu request with a long reply path is not counted',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, async () => {
    deepStrictEqual(await serve(args), expected, 'Got expected result');
  });
});
