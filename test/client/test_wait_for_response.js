const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeInvoiceSubscription} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');

const method = require('./../../client/wait_for_response');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');

const makeArgs = overrides => {
  const args = {
    id: Buffer.alloc(32).toString('hex'),
    lnd: makeLnd({
      subscribeToInvoice: makeInvoiceSubscription({
        invoice: makeInvoice({
          is_confirmed: true,
        }),
      }),
    }),
    ms: 1000,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'Waiting for a response requires an id',
    error: [400, 'ExpectedInvoiceIdToWaitForResponse'],
  },
  {
    args: makeArgs({}),
    description: 'The response is returned',
    expected: {payments: []},
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

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
