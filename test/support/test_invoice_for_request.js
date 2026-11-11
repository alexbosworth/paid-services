const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../support/invoice_for_request');

const offer = 'lno1pgrhxatswphhyaqkyyp3hpx92ea3yezqn9wna4d2hgzkt4c7rq6xqjqel7wp0a0f6hws0rc';

const tests = [
  {
    args: {request: {offer, encoded: '00', mtokens: '1000'}},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToCreateInvoiceForRequest'],
  },
  {
    args: {lnd: {}, request: {offer, encoded: '00'}},
    description: 'An amount is expected',
    error: [400, 'ExpectedAmountToCreateInvoiceForSupporter'],
  },
  {
    args: {lnd: {}, request: {offer, encoded: '00', mtokens: '0'}},
    description: 'A request with an amount of zero is not paid',
    error: [400, 'ExpectedNonZeroAmountForSupportInvoice'],
  },
  {
    args: {lnd: {}, request: {offer, encoded: '00', mtokens: '-1'}},
    description: 'A request with a negative amount is not paid',
    error: [400, 'ExpectedNonZeroAmountForSupportInvoice'],
  },
  {
    args: {lnd: {}, request: {encoded: '00', mtokens: '1000', offer: 'lno'}},
    description: 'An offer that cannot be read is an error, not a throw',
    error: [400, 'ExpectedValidOfferToCreateInvoiceForRequest'],
  },
];

tests.forEach(({args, description, error}) => {
  test(description, async () => {
    return await rejects(method(args), error, 'Got error');
  });
});
