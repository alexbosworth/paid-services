const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../support/erroneous_request_field');

const tests = [
  {
    args: {message: 'ExpectedInvoiceRequestAmountAtLeastOfferAmount'},
    description: 'An amount error is about the amount field',
    expected: {erroneous_field: '82'},
  },
  {
    args: {message: 'ExpectedQuantityWithinOfferMaximumInInvoiceRequest'},
    description: 'A quantity error is about the quantity field',
    expected: {erroneous_field: '86'},
  },
  {
    args: {message: 'ExpectedInvoiceRequestChainToBeOfferChain'},
    description: 'A chain error is about the chain field',
    expected: {erroneous_field: '80'},
  },
  {
    args: {message: 'ExpectedValidPublicKeyPayerIdInInvoiceRequest'},
    description: 'A payer id error is about the payer id field',
    expected: {erroneous_field: '88'},
  },
  {
    args: {message: 'ExpectedChainsInOfferChains'},
    description: 'An offer chains error is about the offer chains field',
    expected: {erroneous_field: '2'},
  },
  {
    args: {message: 'ExpectedValidBlindedPathsInOffer'},
    description: 'An offer paths error is about the offer paths field',
    expected: {erroneous_field: '16'},
  },
  {
    args: {message: 'ExpectedBlindedPathsInOfferPaths'},
    description: 'Empty offer paths are about the offer paths field',
    expected: {erroneous_field: '16'},
  },
  {
    args: {message: 'ExpectedBlindedPathsInInvoiceRequestPaths'},
    description: 'Empty request paths are about the request paths field',
    expected: {erroneous_field: '90'},
  },
  {
    args: {message: 'ExpectedNonZeroAmountInOffer'},
    description: 'A zero offer amount is about the offer amount field',
    expected: {erroneous_field: '8'},
  },
  {
    args: {message: 'ExpectedValidAmountInOffer'},
    description: 'An invalid offer amount is about the offer amount field',
    expected: {erroneous_field: '8'},
  },
  {
    args: {message: 'ExpectedAmountInOfferWithCurrency'},
    description: 'A currency without an amount is about the offer amount',
    expected: {erroneous_field: '8'},
  },
  {
    args: {message: 'ExpectedValidQuantityMaxInOffer'},
    description: 'A quantity max error is about the quantity max field',
    expected: {erroneous_field: '20'},
  },
  {
    args: {message: 'ExpectedQuantityMaxWithinSafeRangeInOffer'},
    description: 'A large quantity max is about the quantity max field',
    expected: {erroneous_field: '20'},
  },
  {
    args: {message: 'UnexpectedUnknownRequiredFeatureBitInOffer'},
    description: 'An offer feature error is about the offer features field',
    expected: {erroneous_field: '12'},
  },
  {
    args: {message: 'UnexpectedUnknownRequiredFeatureBitInInvoiceRequest'},
    description: 'A request feature error is about the request features',
    expected: {erroneous_field: '84'},
  },
  {
    args: {message: 'ExpectedValidPayerIdSignatureInInvoiceRequest'},
    description: 'A bad signature is about the signature field',
    expected: {erroneous_field: '240'},
  },
  {
    args: {message: 'ExpectedValidPublicKeyIssuerIdInOffer'},
    description: 'An issuer id error is about the offer issuer id field',
    expected: {erroneous_field: '22'},
  },
  {
    args: {message: 'ExpectedMetadataInInvoiceRequest'},
    description: 'Missing metadata is about the payer metadata field',
    expected: {erroneous_field: '0'},
  },
  {
    args: {message: 'ExpectedValidBip353NameInInvoiceRequest'},
    description: 'A name error is about the BIP 353 name field',
    expected: {erroneous_field: '91'},
  },
  {
    args: {message: 'ExpectedDescriptionInOfferWithAmount'},
    description: 'An error about records that go together has no field',
    expected: {erroneous_field: undefined},
  },
  {
    args: {message: 'toString'},
    description: 'A message that is not an error message has no field',
    expected: {erroneous_field: undefined},
  },
  {
    args: {message: 'UnexpectedRecordTypeOutsideRequestRangeInInvoiceRequest'},
    description: 'An error that is not about a field has no field',
    expected: {erroneous_field: undefined},
  },
  {
    args: {},
    description: 'No message has no field',
    expected: {erroneous_field: undefined},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
