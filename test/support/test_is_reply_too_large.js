const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {createInvoiceError} = require('invoices');
const {encodeTlvStream} = require('bolt01');

const method = require('./../../support/is_reply_too_large');

const error = createInvoiceError({message: 'InvoiceTooLarge'}).encoded;
const tooLarge = encodeTlvStream({records: [{type: '805807', value: ''}]});

const tests = [
  {
    args: {encoded: error + tooLarge.encoded},
    description: 'An error with the reply too large record says so',
    expected: {is_reply_too_large: true},
  },
  {
    args: {encoded: error},
    description: 'An error without the reply too large record does not',
    expected: {is_reply_too_large: false},
  },
  {
    args: {encoded: 'ff'},
    description: 'An error that is not a TLV stream is not too large',
    expected: {is_reply_too_large: false},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
