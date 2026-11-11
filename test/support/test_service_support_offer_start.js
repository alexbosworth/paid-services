const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');

const {ended} = require('./fixtures/serve_support_offer');
const {idle} = require('./fixtures/serve_support_offer');
const {makeOffer} = require('./fixtures/service_support_offer');
const {makeRecord} = require('./fixtures/serve_support_offer');
const {paths} = require('./fixtures/service_support_offer');
const {requested} = require('./fixtures/serve_support_offer');
const {sentInvoice} = require('./fixtures/serve_support_offer');
const {serve} = require('./fixtures/serve_support_offer');

const listenerFailed = [500, 'UnexpectedErrorInListener'];

const tests = [
  {
    args: {},
    description: 'The start listener is told the offer of the checked record',
    expected: idle,
  },
  {
    args: {is_paying: true, steps: requested},
    description: 'The start listener is told before a request is answered',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
    },
  },
  {
    args: {record: makeRecord({key: Buffer.alloc(32, 3).toString('hex')})},
    description: 'The start listener is not told of a record that fails',
    expected: ended('ExpectedServiceRecordMadeByThisNode'),
  },
  {
    args: {is_stopping_at_start: true, steps: requested},
    description: 'A service stopped as its record is checked does not start',
    expected: {...idle, started: []},
  },
  {
    args: {is_stopping_on_check: true, steps: requested},
    description: 'A service stopped as its record is checked does not start',
    expected: {...idle, started: []},
  },
  {
    args: {is_losing_invoices: true, steps: requested},
    description: 'A service that fails during its record check does not start',
    expected: {
      ...idle,
      errors: [[403, 'PermissionDeniedToSubscribeToInvoices']],
      is_ended: true,
      started: [],
    },
  },
  {
    args: {is_paying: true, steps: requested, throwing: ['start']},
    description: 'A start listener that throws does not end the service',
    expected: {
      ...idle,
      errors: [listenerFailed],
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
    },
  },
  {
    args: {issuer_secret: '07'.repeat(32), steps: requested},
    description: 'A key index not for the offer issuer ends the service',
    expected: ended('ExpectedKeyIndexForSupportOfferIssuerId'),
  },
  {
    args: {
      record: makeRecord({key: Buffer.alloc(32, 3).toString('hex')}),
      steps: requested,
    },
    description: 'A record not made by this node ends the service',
    expected: ended('ExpectedServiceRecordMadeByThisNode'),
  },
  {
    args: {
      record: makeRecord({
        offer: createOffer({networks: ['regtest'], paths}).offer,
      }),
      steps: requested,
    },
    description: 'A record offer without an issuer id ends the service',
    expected: ended('ExpectedOfferWithIssuerIdInSupportRecord'),
  },
  {
    args: {record: makeRecord({offer: makeOffer({})}), steps: requested},
    description: 'An offer not labeled for support ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({offer: makeOffer({id: '0d'.repeat(16), type: '2'})}),
      steps: requested,
    },
    description: 'An offer for another service type ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({
        offer: makeOffer({id: '0d'.repeat(16), max_quantity: 5}),
      }),
      steps: requested,
    },
    description: 'An offer with a maximum quantity ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({
        offer: makeOffer({
          id: '0d'.repeat(16),
          networks: ['regtest', 'testnet'],
        }),
      }),
      steps: requested,
    },
    description: 'An offer for more than one network ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({offer: makeOffer({id: '0d'.repeat(16), major: 2})}),
      steps: requested,
    },
    description: 'A record offer of another major version ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {support_note: 'a'.repeat(129)},
    description: 'A support note is short',
    error: 'ExpectedSupportNoteOfAtMost128BytesToServiceOffer',
  },
  {
    args: {support_note: ''},
    description: 'A support note is not empty',
    error: 'ExpectedSupportNoteOfAtMost128BytesToServiceOffer',
  },
  {
    args: {support_note: 'Thank you!'},
    description: 'A support note is short text',
    expected: idle,
  },
  {
    args: {record: undefined},
    description: 'A record is expected to service a support offer',
    error: 'ExpectedSupportRecordToServiceSupportOffer',
  },
  {
    args: {record_key_indexes: [1, 2]},
    description: 'A record of an index that is not accepted ends the service',
    expected: {
      ...ended('UnexpectedRecordKeyIndexForSupportRecord'),
      record_keys: 0,
    },
  },
  {
    args: {record_key_indexes: [0]},
    description: 'A record of an accepted index is serviced',
    expected: idle,
  },
  {
    args: {record_key_indexes: [2147483648]},
    description: 'Record key indexes are not hardened',
    error: 'ExpectedRecordKeyIndexesToServiceSupportOffer',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(serve(args), new Error(error), 'Got error');
    }

    deepStrictEqual(await serve(args), expected, 'Got expected result');
  });
});
