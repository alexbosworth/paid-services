const {makeLnd} = require('mock-lnd');
const {makePayViaRoutesResponse} = require('mock-lnd');
const {makePaymentRequest} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');

const method = require('./../../respond/send_service_response');

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
    lnd,
    mtokens: '10000',
    request: 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq8rkx3yf5tcsyz3d73gafnh3cax9rn449d9p5uxz9ezhhypd0elx87sjle52x86fux2ypatgddc6k63n7erqz25le42c4u4ecky03ylcqca784w',
    text: 'text',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({error: 'error'}),
    description: 'A request is expected to include valid response records',
    error: [400, 'ExpectedValidServiceResponseToSend'],
  },
  {
    args: makeArgs({mtokens: undefined}),
    description: 'The mtokens received are expected',
    error: [400, 'ExpectedMillitokensReceivedToSendResponse'],
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A response request is expected',
    error: [400, 'ExpectedResponsePaymentRequestToSendResponse'],
  },
  {
    args: makeArgs({request: 'request'}),
    description: 'A valid response request is expected',
    error: [400, 'ExpectedValidPaymentRequestToPayResponse'],
  },
  {
    args: makeArgs({}),
    description: 'An unexpired invoice is required',
    error: [400, 'ExpectedUnexpiredInvoiceToSendServiceResponse'],
  },
  {
    args: makeArgs({mtokens: '1', request: makePaymentRequest({}).request}),
    description: 'Payment cannot be greater than the mtokens received',
    error: [400, 'ExpectedPaymentTokensNotGreaterThanReceived'],
  },
  {
    args: makeArgs({request: makePaymentRequest({mtokens: '0'}).request}),
    description: 'A zero mtokens response is paid',
  },
  {
    args: makeArgs({request: makePaymentRequest({mtokens: '1'}).request}),
    description: 'A service response is delivered',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, rejects}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
