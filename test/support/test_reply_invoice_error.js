const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {decodeTlvStream} = require('bolt01');
const {parseInvoiceError} = require('invoices');

const method = require('./../../support/reply_invoice_error');

// The reply too large record, type 805807 with an empty value
const tooLargeRecord = 'fe000c4baf00';

// Read an invoice error back as BOLT 12 does, with the types of its records
const read = args => {
  const {encoded} = method(args);

  const {erroneous_field, message} = parseInvoiceError({encoded});

  return {
    erroneous_field,
    message,
    is_reply_too_large: encoded.endsWith(tooLargeRecord),
    types: decodeTlvStream({encoded}).records.map(n => n.type),
  };
};

const tests = [
  {
    args: {is_reply_too_large: true, message: 'InvoiceTooLarge'},
    description: 'A reply that is too large is said to be too large',
    expected: {
      erroneous_field: undefined,
      is_reply_too_large: true,
      message: 'InvoiceTooLarge',
      types: ['5', '805807'],
    },
  },
  {
    args: {
      erroneous_field: '2000805807',
      is_reply_too_large: true,
      message: 'PayerOfferTooLarge',
    },
    description: 'A reply too large because of a record names the record',
    expected: {
      erroneous_field: '2000805807',
      is_reply_too_large: true,
      message: 'PayerOfferTooLarge',
      types: ['1', '5', '805807'],
    },
  },
  {
    args: {erroneous_field: '82', message: 'ExpectedAmount'},
    description: 'An error that names a record is a BOLT 12 invoice error',
    expected: {
      erroneous_field: '82',
      is_reply_too_large: false,
      message: 'ExpectedAmount',
      types: ['1', '5'],
    },
  },
  {
    args: {message: 'TooManyUnpaidInvoices'},
    description: 'Other errors are BOLT 12 invoice errors',
    expected: {
      erroneous_field: undefined,
      is_reply_too_large: false,
      message: 'TooManyUnpaidInvoices',
      types: ['5'],
    },
  },
  {
    args: {is_reply_too_large: true},
    description: 'An error message is expected',
    error: 'ExpectedErrorMessageStringToCreateInvoiceError',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => read(args), new Error(error), 'Got error');
    }

    deepStrictEqual(read(args), expected, 'Got expected result');
  });
});
