const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');

const method = require('./../../server/get_service_request');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');
const {keys} = Object;
const paymentRequest = 'lnbc2500u1qpuskf07v3qs6qqqgzqvzq2ps8pqysqqgzqvzq2ps8pqysqqgzqvzq2ps8pqyszqsxs2rzgrrw4czqcm0venx2egrqpq7w393ehf5pfcmx382tjxl3yhcsx5d4tks90vqxg75d4wht32gvjhckp7w45ms008glc2ukggutj38zlf92va7x7qsdgej892uy90t4pcqqg9lc8wdv5qjqfwj9';
const requestRecords = '0093010101038e0001d0018200790b25fe64410d00004080c1014181c20240004080c1014181c20240004080c1014181c202404081a0a189031bab81031b7b33332b2818020f3a258e6e9a0538d9a2752e46fc497c40d46d576815ec0191ea36aebae2a43257c583e7569b83de747f0ae5908e2e5138be92a99df1bc08351991caae10af5d43800105fe0ee6b2800205fe0ee6b2800103000101';

// Make arguments for the method, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {env: {}, id: id1, lnd: makeLnd({}), network: 'btc'};

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({env: undefined}),
    description: 'Getting a service request requires env vars',
    error: [400, 'ExpectedEnvironmentVarsToGetServiceRequest'],
  },
  {
    args: makeArgs({id: undefined}),
    description: 'Getting a service request requires an id',
    error: [400, 'ExpectedInvoiceIdToGetServiceRequest'],
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'Getting a service request requires LND',
    error: [400, 'ExpectedAuthenticatedLndToGetServiceRequest'],
  },
  {
    args: makeArgs({network: undefined}),
    description: 'Getting a service request requires a network name',
    error: [400, 'ExpectedNetworkNameStringToGetServiceRequest'],
  },
  {
    args: makeArgs({}),
    description: 'Getting a request for a random invoice returns nothing',
    expected: {},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getInvoice: ({id}, cbk) => cbk(null, makeInvoice({is_push: true})),
      }),
    }),
    description: 'The reference invoice is expected to be a push',
    expected: {},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getInvoice: ({id}, cbk) => {
          return cbk(null, makeInvoice({
            is_confirmed: true,
            is_push: true,
            payments: [{
              is_confirmed: true,
              messages: [{
                type: '805805',
                value: requestRecords,
              }],
            }],
          }));
        },
      }),
    }),
    description: 'A push request is received',
    expected: {
      error: undefined,
      node: undefined,
      paywall: undefined,
      request: paymentRequest,
      service: {
        arguments: '000101',
        type: '1',
        version: '0',
      },
    },
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getInvoice: ({id}, cbk) => {
          switch (id) {
          case id1:
            return cbk(null, makeInvoice({
              description_hash: id2,
              is_confirmed: true,
            }));

          case id2:
            return cbk(null, makeInvoice({
              is_confirmed: true,
              is_push: true,
              payments: [{
                is_confirmed: true,
                messages: [{
                  type: '805805',
                  value: requestRecords,
                }],
              }],
            }));

          default:
            return cbk([500, 'UnexpectedIdentifierForGetInvoice', {id}]);
          }
        },
      }),
      network: 'network',
    }),
    description: 'A valid network is required',
    expected: {},
  },
  {
    args: makeArgs({
      lnd: makeLnd({
        getInvoice: ({id}, cbk) => {
          switch (id) {
          case id1:
            return cbk(null, makeInvoice({
              description_hash: id2,
              is_confirmed: true,
            }));

          case id2:
            return cbk(null, makeInvoice({
              is_confirmed: true,
              is_push: true,
              payments: [{
                is_confirmed: true,
                messages: [{
                  type: '805805',
                  value: requestRecords,
                }],
              }],
            }));

          default:
            return cbk([500, 'UnexpectedIdentifierForGetInvoice', {id}]);
          }
        },
      }),
    }),
    description: 'An invoice paywall is returns the original request',
    expected: {
      error: undefined,
      node: undefined,
      paywall: makeInvoice({description_hash: id2, is_confirmed: true})
        .payment_request,
      request: paymentRequest,
      service: {
        arguments: '000101',
        type: '1',
        version: '0',
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

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
