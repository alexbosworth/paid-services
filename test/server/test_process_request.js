const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {makeInvoice} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {makePayViaRoutesResponse} = require('mock-lnd');

const messagesForRequest = require('./../../client/messages_for_request');
const method = require('./../../server/process_request');

const id1 = '00'.repeat(32);
const {keys} = Object;
const maxService = String(Number.MAX_SAFE_INTEGER);
const request = 'lnbc10n1y250dfzpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqsjqjp7xkfkr6u6fkcy6nh6x4mez3ge7d4lrj8u8gf0kn74jsdfg3sglhzv4ky5ax3xflrhhmts3t7knrxxrw8hg8k3z39f4jwu5lmywcpzkwrsl';

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const {messages} = messagesForRequest({reply: request, service: '2'});

  let requests = 0;

  const lnd = makeLnd({
    payViaRoutes: ({}, cbk) => {
      requests++;

      if (requests === 2) {
        return cbk(null, makePayViaRoutesResponse({}));
      }

      return cbk(null, makePayViaRoutesResponse({is_unknown_failure: true}));
    },
  });

  const args = {
    env: {},
    fetch: () => {},
    id: id1,
    lnd: makeLnd({
      getInvoice: ({}, cbk) => {
        return cbk(null, makeInvoice({
          is_confirmed: true,
          is_push: true,
          payments: [{messages, is_confirmed: true}],
        }));
      },
    }),
    network: 'btc',
    payer: lnd,
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: () => makeArgs({env: undefined}),
    description: 'Processing a service request requires env vars',
    error: [400, 'ExpectedEnvironmentVarsToProcessPaidRequest'],
  },
  {
    args: () => makeArgs({fetch: undefined}),
    description: 'Processing a service request requires a fetch function',
    error: [400, 'ExpectedFetchFunctionToProcessPaidRequest'],
  },
  {
    args: () => makeArgs({id: undefined}),
    description: 'Processing a service request requires an invoice id',
    error: [400, 'ExpectedInvoiceIdToProcessPaidRequest'],
  },
  {
    args: () => makeArgs({lnd: undefined}),
    description: 'Processing a service request requires lnd to lookup invoice',
    error: [400, 'ExpectedAuthenticatedLndToProcessPaidRequest'],
  },
  {
    args: () => makeArgs({network: undefined}),
    description: 'Processing a service request requires network name',
    error: [400, 'ExpectedNetworkNameToProcessPaidRequest'],
  },
  {
    args: () => makeArgs({payer: undefined}),
    description: 'Processing a service request requires a payer to respond',
    error: [400, 'ExpectedPayerLndToProcessPaidRequest'],
  },
  {
    args: () => makeArgs({network: 'network'}),
    description: 'A request is processed',
    error: [500, 'UnexpectedErrMappingInvoiceToPaidRequest'],
  },
  {
    args: () => makeArgs({}),
    description: 'A request is processed',
    expected: {},
  },
  {
    args: () => makeArgs({
      lnd: makeLnd({
        getInvoice: ({}, cbk) => {
          return cbk(null, makeInvoice({
            is_confirmed: true,
            is_push: true,
            payments: [{
              messages: messagesForRequest({
                reply: request,
                service: maxService,
              }).messages,
              is_confirmed: true,
            }],
          }));
        },
      }),
    }),
    description: 'A request is processed',
    expected: {error: [404, 'UnknownServiceType']},
  },
  {
    args: () => makeArgs({
      lnd: makeLnd({
        getInvoice: ({}, cbk) => {
          return cbk(null, makeInvoice({
            is_confirmed: true,
            is_push: true,
            payments: [{
              messages: messagesForRequest({
                reply: request,
                service: '3',
              }).messages,
              is_confirmed: true,
            }],
          }));
        },
      }),
    }),
    description: 'A request is processed',
    expected: {error: [404, 'ServiceCurrentlyUnsupported']},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    const testArgs = args();

    if (!!error) {
      await rejects(
        method(testArgs),
        err => {
          const [code, message] = err;

          deepStrictEqual([code, message], error, 'Got expected error');

          return true;
        },
        'Got expected error'
      );
    } else {
      const res = await method(testArgs);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
