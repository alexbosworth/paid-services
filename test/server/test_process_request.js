const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {makePayViaRoutesResponse} = require('mock-lnd');
const {makePaymentRequest} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');

const messagesForRequest = require('./../../client/messages_for_request');
const method = require('./../../server/process_request');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');
const {request} = makePaymentRequest({});

const {messages} = messagesForRequest({reply: request, service: '2'});

const makeArgs = overrides => {
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

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Processing a service request requires env vars',
    error: [400, 'ExpectedEnvironmentVarsToProcessPaidRequest'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'Processing a service request requires a fetch function',
    error: [400, 'ExpectedFetchFunctionToProcessPaidRequest'],
  },
  {
    args: makeArgs({id: undefined}),
    description: 'Processing a service request requires an invoice id',
    error: [400, 'ExpectedInvoiceIdToProcessPaidRequest'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Processing a service request requires lnd to lookup invoice',
    error: [400, 'ExpectedAuthenticatedLndToProcessPaidRequest'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'Processing a service request requires network name',
    error: [400, 'ExpectedNetworkNameToProcessPaidRequest'],
  },
  {
    args: makeArgs({payer: undefined}),
    description: 'Processing a service request requires a payer to respond',
    error: [400, 'ExpectedPayerLndToProcessPaidRequest'],
  },
  {
    args: makeArgs({network: 'network'}),
    description: 'A request is processed',
    error: [500, 'UnexpectedErrMappingInvoiceToPaidRequest'],
  },
  {
    args: makeArgs({}),
    description: 'A request is processed',
    expected: {},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getInvoice: ({}, cbk) => {
          return cbk(null, makeInvoice({
            is_confirmed: true,
            is_push: true,
            payments: [{
              messages: messagesForRequest({
                reply: request,
                service: Number.MAX_SAFE_INTEGER.toString(),
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
    args: makeArgs({
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
