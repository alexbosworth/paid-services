const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeInvoiceSubscription} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');

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
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
