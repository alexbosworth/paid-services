const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {makePayViaRoutesResponse} = require('mock-lnd');
const {makePaymentRequest} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');
const tinysecp = require('tiny-secp256k1');

const messagesForRequest = require('./../../client/messages_for_request');
const method = require('./../../server/paid_service_event');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');

(async () => {
  const ecp = (await import('ecpair')).ECPairFactory(tinysecp);

  const {request} = makePaymentRequest({ecp});

  const {messages} = messagesForRequest({reply: request, service: '2'});

  const makeArgs = overrides => {
    let requests = 0;

    const lnd = makeLnd({
      getInvoice: ({}, cbk) => {
        return cbk(null, makeInvoice({
          is_confirmed: true,
          is_push: true,
          payments: [{messages, is_confirmed: true}],
        }));
      },
      payViaRoutes: ({}, cbk) => {
        requests++;

        if (requests === 2) {
          return cbk(null, makePayViaRoutesResponse({}));
        }

        return cbk(null, makePayViaRoutesResponse({is_unknown_failure: true}));
      },
    });

    const args = {
      lnd,
      env: {},
      fetch: () => new Promise(resolve => resolve()),
      id: id1,
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
      error: [400, 'ExpectedEnvironmentVariablesForPaidServiceEvent'],
    },
    {
      args: makeArgs({fetch: undefined}),
      description: 'Processing a service request requires a fetch function',
      error: [400, 'ExpectedFetchFunctionForPaidServiceEvent'],
    },
    {
      args: makeArgs({id: undefined}),
      description: 'Processing a service request requires an invoice id',
      error: [400, 'ExpectedInvoiceIdForPaidServiceEvent'],
    },
    {
      args: makeArgs({lnd: undefined}),
      description: 'Processing a service request requires lnd to lookup invoice',
      error: [400, 'ExpectedAuthenticatedLndForPaidServiceEvent'],
    },
    {
      args: makeArgs({network: undefined}),
      description: 'Processing a service request requires network name',
      error: [400, 'ExpectedNetworkNameStringToGetServiceRequest'],
    },
    {
      args: makeArgs({payer: undefined}),
      description: 'Processing a service request requires a payer to respond',
      error: [400, 'ExpectedPayerLndForPaidServiceEvent'],
    },
    {
      args: makeArgs({}),
      description: 'A paid service event happens',
      expected: {
        error: undefined,
        node: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
        service: 'ping',
      },
    },
    {
      args: makeArgs({
        lnd: makeLnd({
          getInvoice: ({}, cbk) => {
            return cbk(null, makeInvoice({
              is_confirmed: true,
              is_push: true,
              payments: [],
            }));
          },
        }),
      }),
      description: 'A random push happens',
      expected: {},
    },
    {
      args: makeArgs({
        env: {
          PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
          PAID_SERVICES_INBOX_EMAIL_TO: 'to',
          PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
          PAID_SERVICES_INBOX_PRICE: '1',
        },
        lnd: makeLnd({
          getInvoice: ({id}, cbk) => {
            switch (id) {
            // Return a paywall invoice
            case id1:
              return cbk(null, makeInvoice({
                description_hash: id2,
                is_confirmed: true,
              }));

            // Return a keysend invoice
            case id2:
              return cbk(null, makeInvoice({
                is_confirmed: true,
                is_push: true,
                payments: [{
                  is_confirmed: true,
                  messages: messagesForRequest({
                    arguments: encode({
                      type: '0',
                      value: Buffer.from('message').toString('hex'),
                    }),
                    reply: request,
                    service: '4',
                  }).messages,
                }],
              }));

            default:
              return cbk([500, 'UnexpectedIdentifierForGetInvoice', {id}]);
            }
          },
        }),
      }),
      description: 'A paywall request is processed',
      expected: {
        error: undefined,
        node: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
        service: 'inbox',
      },
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
      expected: {
        error: [404, 'ServiceCurrentlyUnsupported'],
        node: '03e7156ae33b0a208d0744199163177e909e80176e55d97a2f221ede0f934dd9ad',
        service: 'profile',
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
})();
