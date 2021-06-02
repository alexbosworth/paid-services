const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeInvoiceSubscription} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {test} = require('tap');

const method = require('./../../client/confirm_service_use');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');

const makeArgs = overrides => {
  const args = {
    ask: (n, cbk) => {
      const [query] = n;

      if (query.type === 'confirm') {
        return cbk({proceed: true});
      }

      return cbk({'0': 'value'})
    },
    description: 'description',
    fields: [{
      description: 'description',
      limit: 10,
      type: '0',
    }],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({ask: undefined}),
    description: 'Confirming use requires an ask function',
    error: [400, 'ExpectedInquirerFunctionToConfirmServiceUse'],
  },
  {
    args: makeArgs({}),
    description: 'The response is returned',
    expected: {arguments: '000576616c7565'},
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
