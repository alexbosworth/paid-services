const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const method = require('./../../support/invoice_for_request');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');

const issuerId = bufferAsHex(pointFromScalar(Buffer.alloc(32, 1)));

const {offer} = createOffer({description: 'support', issuer_id: issuerId});

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
