const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeInvoiceSubscription} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {makePaySubscription} = require('mock-lnd');
const {makePayViaRoutesResponse} = require('mock-lnd');
const {makePaymentRequest} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');

const messagesForResponse = require('./../../respond/messages_for_response');
const method = require('./../../client/make_service_request');
const responseForSchema = require('./../../services/response_for_schema');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');
const {request} = makePaymentRequest({});

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
    subscribeToInvoice: makeInvoiceSubscription({
      invoice: makeInvoice({
        is_confirmed: true,
        is_push: true,
        payments: [{
          is_confirmed: true,
          messages: messagesForResponse({
            records: [
              {type: '1', value: '04'},
              {type: '2', value: Buffer.from('description').toString('hex')},
            ],
          }).messages,
        }],
      }),
    }),
  });

  const args = {
    lnd,
    id: Buffer.alloc(32).toString('hex'),
    ms: 1000,
    network: 'btc',
    node: Buffer.alloc(33, 3).toString('hex'),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'Waiting for a response requires a service id',
    error: [400, 'ExpectedServiceIdNumberToMakeServiceRequest'],
  },
  {
    args: makeArgs({}),
    description: 'The response is returned',
    expected: {
      links: undefined,
      nodes: undefined,
      paywall: undefined,
      records: [
        {type: '1', value: '04'},
        {type: '2', value: '6465736372697074696f6e'},
      ],
      text: undefined,
    },
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
