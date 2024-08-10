const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {makePaymentRequest} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');
const tinysecp = require('tiny-secp256k1');

const messagesForRequest = require('./../../client/messages_for_request');
const method = require('./../../server/process_paywall');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');

(async () => {
  const ecp = (await import('ecpair')).ECPairFactory(tinysecp);

  const {request} = makePaymentRequest({ecp});

  const {messages} = messagesForRequest({reply: request, service: '2'});

  const makeArgs = overrides => {
    const args = {
      env: {
        PAID_SERVICES_INBOX_EMAIL_FROM: 'from',
        PAID_SERVICES_INBOX_EMAIL_TO: 'to',
        PAID_SERVICES_INBOX_POSTMARK_API_KEY: 'key',
        PAID_SERVICES_INBOX_PRICE: '1',
      },
      fetch: () => new Promise(resolve => resolve()),
      id: id1,
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
      network: 'btc',
      payer: makeLnd({}),
    };

    Object.keys(overrides).forEach(k => args[k] = overrides[k]);

    return args;
  };

  const tests = [
    {
      args: makeArgs({env: undefined}),
      description: 'Processing a paywall requires env vars',
      error: [400, 'ExpectedEnvironmentVariablesToProcessPaywall'],
    },
    {
      args: makeArgs({fetch: undefined}),
      description: 'Processing a paywall requires a fetch function',
      error: [400, 'ExpectedFetchFunctionToProcessPaywallPayment'],
    },
    {
      args: makeArgs({id: undefined}),
      description: 'Processing a paywall requires an invoice id',
      error: [400, 'ExpectedInvoiceIdToProcessPaywallRequest'],
    },
    {
      args: makeArgs({lnd: undefined}),
      description: 'Processing a paywall requires lnd',
      error: [400, 'ExpectedLndToProcessPaywallRequest'],
    },
    {
      args: makeArgs({network: undefined}),
      description: 'Processing a paywall requires a network name',
      error: [400, 'ExpectedNetworkNameToProcessPaywallRequest'],
    },
    {
      args: makeArgs({}),
      description: 'A paywall is processed',
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