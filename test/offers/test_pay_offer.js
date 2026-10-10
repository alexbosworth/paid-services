const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../offers/pay_offer');

const tests = [
  {
    args: {},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToPayOffer'],
  },
  {
    args: {lnd: {}, offer: 'lno1'},
    description: 'A max fee is expected',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOffer'],
  },
  {
    args: {lnd: {}, max_fee_mtokens: '0'},
    description: 'An offer is expected',
    error: [400, 'ExpectedOfferToPay'],
  },
  {
    args: {lnd: {}, max_fee_mtokens: 'x', offer: 'lno1'},
    description: 'A max fee is millitokens',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOffer'],
  },
  {
    args: {lnd: {}, max_fee_mtokens: 0, offer: 'lno1'},
    description: 'A max fee is a string of millitokens, not a number',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOffer'],
  },
  {
    args: {lnd: {}, max_fee_mtokens: null, offer: 'lno1'},
    description: 'A max fee is not null',
    error: [400, 'ExpectedMaxFeeMillitokensToPayOffer'],
  },
  {
    args: {lnd: {}, max_fee_mtokens: '0', offer: 'lno1', timeout: -1},
    description: 'A timeout is a number of milliseconds',
    error: [400, 'ExpectedTimeoutMillisecondsToPayOffer'],
  },
];

tests.forEach(({args, description, error}) => {
  test(description, async () => {
    await rejects(method(args), error, 'Got error');
  });
});
