const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');
const {makeLnd} = require('mock-lnd');
const {parsePaymentRequest} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');

const method = require('./../../services/response_for_invoice');

const encode = records => encodeTlvStream({records}).encoded;
const {keys} = Object;
const publicKeyOf = key => Buffer.from(pointFromScalar(key)).toString('hex');
const secret = Buffer.alloc(32, 1);
const to = Buffer.alloc(33, 2).toString('hex');
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

// Describe a paywall by the payment that it requests
const describePaywall = res => {
  const request = parsePaymentRequest({request: res.response.paywall});

  return {
    response: {
      paywall: {
        description: request.description,
        destination: request.destination,
        tokens: request.tokens,
      },
      text: res.response.text,
    },
  };
};

// Make arguments to respond to an invoice request, with overrides
const makeArgs = overrides => {
  const args = {
    to,
    arguments: encode([
      {type: '1', value: utf8AsHex('1000')},
      {type: '3', value: utf8AsHex('description')},
    ]),
    env: {PAID_SERVICES_INVOICE: '1'},
    lnd: makeLnd({secret: secret.toString('hex')}),
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({arguments: 'arguments'}),
    description: 'Valid arguments are expected',
    error: [400, 'ExpectedTlvStreamArgumentsForInvoiceService'],
  },
  {
    args: makeArgs({env: undefined}),
    description: 'Environment variables are expected',
    error: [400, 'ExpectedEnvToGenerateInvoiceResponse'],
  },
  {
    args: makeArgs({env: {}}),
    description: 'The invoice service is expected to be enabled',
    error: [404, 'InvoiceServiceNotEnabled'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGenerateInvoiceServiceResponse'],
  },
  {
    args: makeArgs({to: undefined}),
    description: 'The requesting node is expected',
    error: [400, 'ExpectedInvoiceResponseToForInvoiceResponse'],
  },
  {
    args: makeArgs({
      arguments: encode([{type: '1', value: utf8AsHex('1'.repeat(21))}]),
    }),
    description: 'A short amount is expected',
    error: [400, 'ExpectedShorterAmountForNewInvoice'],
  },
  {
    args: makeArgs({arguments: encode([{type: '1', value: utf8AsHex('a')}])}),
    description: 'A numeric amount is expected',
    error: [400, 'ExpectedNumericValueForNewInvoice'],
  },
  {
    args: makeArgs({
      arguments: encode([{type: '1', value: utf8AsHex('1e3')}]),
    }),
    description: 'An amount in exponent notation is not read as 1',
    error: [400, 'ExpectedNumericValueForNewInvoice'],
  },
  {
    args: makeArgs({
      arguments: encode([{type: '1', value: utf8AsHex('1.9')}]),
    }),
    description: 'A fractional amount is not rounded down',
    error: [400, 'ExpectedNumericValueForNewInvoice'],
  },
  {
    args: makeArgs({
      arguments: encode([{type: '1', value: utf8AsHex('0x10')}]),
    }),
    description: 'A hex amount is not read as a number',
    error: [400, 'ExpectedNumericValueForNewInvoice'],
  },
  {
    args: makeArgs({
      arguments: encode([{type: '3', value: utf8AsHex('d'.repeat(101))}]),
    }),
    description: 'A long description is returned as an error',
    error: [400, 'ExpectedShorterDescriptionForNewInvoice'],
  },
  {
    args: makeArgs({}),
    description: 'An invoice is created',
    expected: {
      response: {
        paywall: {
          description: `description for ${to}`,
          destination: publicKeyOf(secret),
          tokens: 1000,
        },
        text: 'Created invoice!',
      },
    },
  },
  {
    args: makeArgs({arguments: undefined}),
    description: 'An invoice is created without arguments',
    expected: {
      response: {
        paywall: {
          description: `invoice for ${to}`,
          destination: publicKeyOf(secret),
          tokens: 0,
        },
        text: 'Created invoice!',
      },
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(
        method(args),
        err => {
          deepStrictEqual(err, error, 'Got expected error');

          return true;
        },
        'Got expected error'
      );
    } else {
      const res = await method(args);

      deepStrictEqual(describePaywall(res), expected, 'Got expected result');
    }
  });
});
