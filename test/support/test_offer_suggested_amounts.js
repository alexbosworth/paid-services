const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');
const {encodeTlvStream} = require('bolt01');
const {pointFromScalar} = require('tiny-secp256k1');

const addOfferRecords = require('./../../support/add_offer_records');
const decode = require('./../../support/decode_suggested_amounts');
const encode = require('./../../support/encode_suggested_amounts');
const suggestedAmounts = require('./../../support/offer_suggested_amounts');

const issuer = Buffer.from(pointFromScalar(Buffer.alloc(32, 1)))
  .toString('hex');
const type = '1000805807';

// Make a suggested amounts record value from its own records
const stream = records => encodeTlvStream({records}).encoded;

// Make a suggested amounts record value of raw amounts
const list = amounts => stream([{type: '0', value: amounts}]);

// Make an offer with a raw suggested amounts record value
const withRecord = (args, value) => addOfferRecords({
  offer: createOffer({issuer_id: issuer, networks: ['regtest'], ...args})
    .offer,
  records: [{type, value}],
})
.offer;

// Make an offer with raw suggested amounts
const withAmounts = (args, amounts) => withRecord(args, list(amounts));

// Suggested amounts records: amounts of 500 and 2,000, and a currency
const amountMillion = '00000000000f4240';
const amounts = {type: '0', value: '00000000000001f4'};
const currency = value => ({value, type: '2'});
const inUsd = '0010' + '00000000000001f4' + '00000000000007d0' + '0203555344';

const tests = [
  {
    args: {offer: withAmounts({}, '00000000000f424000000000004c4b40')},
    description: 'Suggested amounts are read from an offer',
    expected: {mtokens: ['1000000', '5000000']},
    method: suggestedAmounts,
  },
  {
    args: {offer: createOffer({issuer_id: issuer}).offer},
    description: 'An offer without suggested amounts has none',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withAmounts({}, '0001')},
    description: 'Suggested amounts that are not valid are ignored',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withAmounts({}, '00000000000f42400000000000000000')},
    description: 'A suggested amount of zero is not valid',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {
      offer: withAmounts(
        {description: 'print', mtokens: '9000'},
        '0000000000002710'
      ),
    },
    description: 'An offer with an amount has no suggested amounts',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withAmounts({max_quantity: 5}, '0000000000002710')},
    description: 'An offer with a quantity has no suggested amounts',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: 'lno1'},
    description: 'An offer is expected',
    error: 'ExpectedValidOfferToGetSuggestedAmounts',
    method: suggestedAmounts,
  },
  {
    args: {offer: withAmounts({networks: undefined}, '00000000000f4240')},
    description: 'An offer without chains is for bitcoin',
    expected: {mtokens: ['1000000']},
    method: suggestedAmounts,
  },
  {
    args: {
      offer: withAmounts({networks: ['testnet', 'signet']}, amountMillion),
    },
    description: 'An offer for two networks has no suggested amounts',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {amounts: ['500', '2000'], currency: 'USD'},
    description: 'Suggested amounts and their currency are records',
    expected: {encoded: inUsd},
    method: encode,
  },
  {
    args: {encoded: inUsd},
    description: 'Suggested amounts in a currency are read from records',
    expected: {amounts: ['500', '2000'], currency: 'USD'},
    method: decode,
  },
  {
    args: {offer: withRecord({}, inUsd)},
    description: 'Suggested amounts can be in a currency',
    expected: {amounts: ['500', '2000'], currency: 'USD', mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withRecord({}, stream([amounts, currency('757364')]))},
    description: 'A currency that is not uppercase is ignored',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withRecord({}, stream([amounts, currency('5553')]))},
    description: 'A currency that is not 3 letters is ignored',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withRecord({}, stream([amounts, {type: '4', value: '00'}]))},
    description: 'Suggested amounts with an unknown even record are ignored',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withRecord({}, stream([currency('555344')]))},
    description: 'A currency without amounts is ignored',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {offer: withRecord({}, stream([amounts, {type: '5', value: '00'}]))},
    description: 'An unknown odd record is ignored',
    expected: {mtokens: ['500']},
    method: suggestedAmounts,
  },
  {
    args: {offer: withRecord({}, '00000000000001f4')},
    description: 'Suggested amounts that are not a TLV stream are ignored',
    expected: {mtokens: []},
    method: suggestedAmounts,
  },
  {
    args: {amounts: ['500'], currency: 'usd'},
    description: 'A currency is an ISO 4217 code',
    error: 'ExpectedIso4217CurrencyCodeToEncodeSuggestedAmounts',
    method: encode,
  },
  {
    args: {
      offer: withAmounts({}, '0000000000002710'),
      records: [{type, value: '00'}],
    },
    description: 'Records that an offer already has cannot be added',
    error: 'UnexpectedExistingRecordTypeInOffer',
    method: addOfferRecords,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
