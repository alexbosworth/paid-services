const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {pointFromScalar} = require('tiny-secp256k1');

const createMenuRequest = require('./../../support/create_menu_request');
const method = require('./../../support/offer_for_request');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const otherPathId = Buffer.alloc(32).toString('hex');
const pathId = Buffer.alloc(32, 3).toString('hex');
const payerId = asKey(2);
const payerSecret = Buffer.alloc(32, 2).toString('hex');

const issuerId = asKey(1);
const path = blindedPathFromHops({hops: [issuerId], id: pathId});
const paths = [{hops: path.path, introduction_node: issuerId, key: path.key}];

// Make an offer of the issuer on the path
const makeOffer = ({description, mtokens}) => createOffer({
  description,
  mtokens,
  paths,
  issuer_id: issuerId,
  networks: ['regtest'],
})
.offer;

// An offer with an amount, and one without, like a support offer
const amountless = makeOffer({description: 'support'});
const offer = makeOffer({description: 'description', mtokens: '1000'});

// Make the records of an unsigned request for an offer
const unsignedRecords = forOffer => {
  const {encoded} = createUnsignedInvoiceRequest({
    mtokens: '1000',
    network: 'regtest',
    offer: forOffer,
    payer_id: payerId,
  });

  return decodeTlvStream({encoded}).records.map(({type, value}) => ({
    type,
    value,
  }));
};

// Make a signed request for an offer, with records added
const makeRequest = (forOffer, records) => createSignedInvoiceRequest({
  encoded: encodeTlvStream({
    records: unsignedRecords(forOffer).concat(records || []),
  })
  .encoded,
  secret: payerSecret,
})
.encoded;

// Make a signed menu request with a menu request record value
const makeMenuRequest = value => makeRequest(amountless, [{
  value,
  type: '2000805805',
}]);

// Match a request to an offer, keeping the parts of the request that matter
const match = args => {
  const {request, ...matched} = method(args);

  // Exit early when there is no request
  if (!request) {
    return matched;
  }

  const {mtokens, offer, payer_id} = request;

  return {...matched, request: {mtokens, offer, payer_id}};
};

// Offers serviced on the path
const serviced = [{offer, path_id: pathId}];
const support = [{offer: amountless, path_id: pathId}];

// The parts of a request for the support offer
const supportRequest = {
  mtokens: '1000',
  offer: amountless,
  payer_id: payerId,
};

// The error for a menu request that is not understood
const unsupported = {
  erroneous_field: '2000805805',
  message: 'UnsupportedSupportMenuRequest',
};

// A menu request that is not replied to
const ignored = {is_ignored: true, is_menu: true};

// Change the last byte of the signature of a request so it is not valid
const withBadSignature = encoded => {
  const {records} = decodeTlvStream({encoded});

  return encodeTlvStream({
    records: records.map(({type, value}) => {
      // Exit early when the record is not the signature
      if (type !== '240') {
        return {type, value};
      }

      const last = value.endsWith('00') ? '01' : '00';

      return {type, value: value.slice(0, -2) + last};
    }),
  })
  .encoded;
};

const tests = [
  {
    args: {offers: serviced, path_id: pathId, value: makeRequest(offer)},
    description: 'A request for a serviced offer on its path is matched',
    expected: {
      offer: serviced[0],
      request: {offer, mtokens: '1000', payer_id: payerId},
    },
  },
  {
    args: {offers: serviced, value: makeRequest(offer)},
    description: 'A request that did not arrive on a path is ignored',
    expected: {},
  },
  {
    args: {offers: serviced, path_id: otherPathId, value: makeRequest(offer)},
    description: 'A request that did not arrive on the offer path is ignored',
    expected: {},
  },
  {
    args: {
      offers: serviced,
      path_id: pathId,
      value: makeRequest(makeOffer({description: 'other', mtokens: '1000'})),
    },
    description: 'A request for another offer on an offer path is an error',
    expected: {
      error: {message: 'UnknownOfferForInvoiceRequest'},
      request: {
        mtokens: '1000',
        offer: makeOffer({description: 'other', mtokens: '1000'}),
        payer_id: payerId,
      },
    },
  },
  {
    args: {offers: serviced, path_id: pathId, value: '00'},
    description: 'An invalid request on an offer path is an error',
    expected: {
      error: {
        erroneous_field: undefined,
        message: 'ExpectedValidTlvStreamToDecodeRecords',
      },
    },
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: createMenuRequest({offer: amountless, secret: payerSecret})
        .encoded,
    },
    description: 'A request with the menu request record asks for the menu',
    expected: {
      is_menu: true,
      offer: support[0],
      page: 0,
      request: supportRequest,
    },
  },
  {
    args: {
      offers: support,
      path_id: otherPathId,
      value: createMenuRequest({offer: amountless}).encoded,
    },
    description: 'A menu request on another path is ignored',
    expected: {},
  },
  {
    args: {offers: support, path_id: pathId, value: makeMenuRequest('')},
    description: 'A menu request without a page asks for the first page',
    expected: {
      is_menu: true,
      offer: support[0],
      page: 0,
      request: supportRequest,
    },
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: createMenuRequest({
        offer: amountless,
        page: 2,
        secret: payerSecret,
      })
      .encoded,
    },
    description: 'A menu request can ask for a page of the menu',
    expected: {
      is_menu: true,
      offer: support[0],
      page: 2,
      request: supportRequest,
    },
  },
  {
    args: {offers: support, path_id: pathId, value: makeMenuRequest('0100')},
    description: 'A menu request with an unknown odd option asks for the menu',
    expected: {
      is_menu: true,
      offer: support[0],
      page: 0,
      request: supportRequest,
    },
  },
  {
    args: {offers: support, path_id: pathId, value: makeMenuRequest('0200')},
    description: 'A menu request with an unknown even option is an error',
    expected: {
      error: unsupported,
      is_menu: true,
      offer: support[0],
      request: supportRequest,
    },
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: makeMenuRequest('00020001'),
    },
    description: 'A menu request with a page that cannot be read is an error',
    expected: {
      error: unsupported,
      is_menu: true,
      offer: support[0],
      request: supportRequest,
    },
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: encodeTlvStream({
        records: unsignedRecords(amountless).filter(n => n.type !== '82'),
      })
      .encoded,
    },
    description: 'A request without an amount for an offer without one fails',
    expected: {
      error: {
        erroneous_field: '82',
        message: 'ExpectedAmountInInvoiceRequestForOfferWithoutAmount',
      },
    },
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: encodeTlvStream({
        records: unsignedRecords(amountless).concat({
          type: '2000805805',
          value: '',
        }),
      })
      .encoded,
    },
    description: 'An unsigned menu request is ignored',
    expected: ignored,
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: withBadSignature(
        createMenuRequest({offer: amountless, secret: payerSecret}).encoded
      ),
    },
    description: 'A menu request with a signature not valid is ignored',
    expected: ignored,
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: createMenuRequest({
        offer: makeOffer({description: 'other'}),
        secret: payerSecret,
      })
      .encoded,
    },
    description: 'A menu request for another offer on the path is ignored',
    expected: ignored,
  },
  {
    args: {
      offers: support,
      path_id: pathId,
      value: withBadSignature(makeMenuRequest('0200')),
    },
    description: 'A menu request that is not valid is ignored before options',
    expected: ignored,
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(match(args), expected, 'Got expected result');
  });
});
