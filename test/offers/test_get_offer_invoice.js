const {deepStrictEqual, rejects} = require('node:assert/strict');
const {mock} = require('node:test');
const {test} = require('node:test');

const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {getPublicKey} = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {parseInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const {edgeChannel} = require('./fixtures/get_offer_invoice');
const {edgeInvoice} = require('./fixtures/get_offer_invoice');
const {edgeNode2} = require('./fixtures/get_offer_invoice');
const {edgePath} = require('./fixtures/get_offer_invoice');
const {featured} = require('./fixtures/get_offer_invoice');
const {first} = require('./fixtures/get_offer_invoice');
const {fromPayer} = require('./fixtures/get_offer_invoice');
const {fromPayerOffer} = require('./fixtures/get_offer_invoice');
const {invoice} = require('./fixtures/get_offer_invoice');
const {issuer} = require('./fixtures/get_offer_invoice');
const {issuerOnly} = require('./fixtures/get_offer_invoice');
const makeInvoice = require('./fixtures/make_invoice');
const {makeOffer} = require('./fixtures/get_offer_invoice');
const network = require('./../../network');
const {offer} = require('./fixtures/get_offer_invoice');
const {pathNumbers} = require('./fixtures/get_offer_invoice');
const {payerKeyFamily} = require('./../../offers/constants');
const {paymentPath} = require('./fixtures/get_offer_invoice');
const {second} = require('./fixtures/get_offer_invoice');

const bufferAsHex = buffer => buffer.toString('hex');
const ended = [503, 'NetworkReplyListenerEnded'];
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const mtokens = '1000';
const past = '2025-01-01T00:00:00.000Z';

// Get the public key of a secret of 32 bytes of a number
const asKey = n => {
  return Buffer.from(pointFromScalar(Buffer.alloc(32, n))).toString('hex');
};

// Reply to a request with the reply the fake LND has for the path
const fakeReply = ({lnd, message, path}, cbk) => {
  lnd.requested.push(path);
  lnd.sent.push(message.value);

  // A path that the payer made to an issuer id is replied to by the issuer
  const reply = lnd.replies[path.key] || lnd.replies[path.introduction_node];

  return reply(message.value, cbk);
};

// Replies are faked by the path the request is sent over, so that no onion
// messages are sent
mock.method(network, 'requestNetworkReply', fakeReply);

const method = require('./../../offers/get_offer_invoice');

// The recipient replies with an invoice that has expired
const expired = (encoded, cbk) => {
  const {encoded: value} = makeInvoice({
    encoded,
    created_at: '2024-12-31T00:00:00.000Z',
    expires_at: past,
    paths: [paymentPath],
  });

  return cbk(null, {reply: {value, type: '66'}});
};

// The recipient replies with an invoice error
const refused = (encoded, cbk) => {
  const {encoded: value} = createInvoiceError({message: 'refused'});

  return cbk(null, {reply: {value, type: '68'}});
};

// There is no reply
const unreplied = (encoded, cbk) => cbk(ended);

// Make a fake LND of the payer with replies to requests over the first and
// second paths, that knows of a channel when it is given. A payer key was
// derived before, so the next payer key is at index 1.
const makeTestLnd = ([toFirst, toSecond], channel) => {
  const lnd = makeLnd({
    graph: {channels: !channel ? [] : [channel]},
    next_key_indexes: [{family: payerKeyFamily, index: 1}],
    secret: bufferAsHex(Buffer.alloc(32, 4)),
  });

  lnd.replies = {[first.key]: toFirst, [second.key]: toSecond};
  lnd.requested = [];
  lnd.sent = [];

  // A request sent to the issuer over a path made to it gets the first reply
  lnd.replies[issuer] = toFirst;

  // A request sent over the path that starts at the payer gets the first reply
  lnd.replies[fromPayer.key] = toFirst;

  return lnd;
};

// A fake LND that cannot derive a key
const underived = () => {
  const lnd = makeTestLnd([invoice, invoice]);

  lnd.wallet.deriveNextKey = ({}, cbk) => cbk('err');

  return lnd;
};

// A fake LND that derives a key that is not a public key
const misderived = () => {
  const lnd = makeTestLnd([invoice, invoice]);

  lnd.wallet.deriveNextKey = (args, cbk) => cbk(null, {
    key_loc: {key_family: args.key_family, key_index: 1},
    raw_key_bytes: hexAsBuffer(`02${'ff'.repeat(32)}`),
  });

  return lnd;
};

// A fake LND that cannot sign
const unsigned = () => {
  const lnd = makeTestLnd([invoice, invoice]);

  lnd.signer.signMessage = ({}, cbk) => cbk('err');

  return lnd;
};

// A fake LND that signs with another key than the one at the key locator
const missigned = () => {
  const lnd = makeTestLnd([invoice, invoice]);
  const other = {key_family: payerKeyFamily, key_index: 99};

  const {signMessage} = lnd.signer;

  lnd.signer.signMessage = (args, cbk) => {
    return signMessage({...args, key_loc: other}, cbk);
  };

  return lnd;
};

// The payer keys that were derived for the request, by their key index
const keysDerived = lnd => lnd.calls
  .filter(n => n.method === 'deriveNextKey')
  .map(n => n.response.key_loc.key_index);

// The paths that requests were sent over, by their number or by their start
const tried = lnd => lnd.requested.map(path => {
  return pathNumbers[path.key] || path.introduction_node;
});

// Get an invoice and see what it is like and which paths were tried
const getInvoice = async args => {
  const got = await method(args);

  // The payer id is the key that LND derives at the payer key index
  const payerKey = await getPublicKey({
    family: payerKeyFamily,
    index: got.payer_key_index,
    lnd: args.lnd,
  });

  // The requests that were sent are read, which checks their signatures
  const sent = args.lnd.sent.map(encoded => parseInvoiceRequest({encoded}));

  return {
    description: got.description,
    features: got.features,
    is_payer_key: payerKey.public_key === got.payer_id,
    is_signed_by_payer: sent.every(n => n.payer_id === got.payer_id),
    mtokens: got.mtokens,
    names: sent.map(n => n.bip353_name).filter(n => !!n),
    paths: got.paths,
    payer_key_index: got.payer_key_index,
    requested: tried(args.lnd),
  };
};

// Make an offer whose only path starts at a channel edge that is not known
const unknownEdge = () => createOffer({
  issuer_id: asKey(1),
  networks: ['bitcoin'],
  paths: [{hops: first.hops, introduction_edge: '1x1x1x0', key: first.key}],
})
.offer;

const tests = [
  {
    args: {},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToGetOfferInvoice'],
  },
  {
    args: {lnd: {}},
    description: 'An offer is expected',
    error: [400, 'ExpectedOfferToGetOfferInvoice'],
  },
  {
    args: {lnd: {}, offer: 'lno1', timeout: 0},
    description: 'A timeout is a number of milliseconds',
    error: [400, 'ExpectedTimeoutMillisecondsToGetOfferInvoice'],
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([invoice, invoice])},
    derived: [1],
    description: 'An invoice is returned with the derived key of the payer',
    expected: {
      mtokens,
      description: 'thing',
      features: [],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: [],
      paths: [paymentPath],
      payer_key_index: 1,
      requested: [1],
    },
  },
  {
    args: {
      mtokens,
      offer,
      bip353_name: 'alice@example.com',
      lnd: makeTestLnd([invoice, invoice]),
    },
    description: 'The request has the name that the offer was found with',
    expected: {
      mtokens,
      description: 'thing',
      features: [],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: ['alice@example.com'],
      paths: [paymentPath],
      payer_key_index: 1,
      requested: [1],
    },
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: fromPayerOffer,
    },
    description: 'An offer path that starts at the payer is requested over',
    expected: {
      mtokens,
      description: 'thing',
      features: [],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: [],
      paths: [paymentPath],
      payer_key_index: 1,
      requested: [3],
    },
  },
  {
    args: {mtokens, lnd: makeTestLnd([invoice, invoice]), offer: issuerOnly},
    description: 'An offer without paths is requested at its issuer id',
    expected: {
      mtokens,
      description: 'thing',
      features: [],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: [],
      paths: [paymentPath],
      payer_key_index: 1,
      requested: [issuer],
    },
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([featured, invoice])},
    description: 'An invoice is returned with its features',
    expected: {
      mtokens,
      description: 'thing',
      features: [{bit: 17, is_required: false, type: 'multipath_payments_v0'}],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: [],
      paths: [paymentPath],
      payer_key_index: 1,
      requested: [1],
    },
  },
  {
    args: {mtokens, lnd: makeTestLnd([invoice, invoice]), offer: 'lno1'},
    derived: [],
    description: 'An offer has to be valid to request an invoice for it',
    error: [400, 'ExpectedValidOfferToPay'],
    requested: [],
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: makeOffer({amount: '100', currency: 'USD'}),
    },
    derived: [],
    description: 'An offer with an amount in a currency has no key derived',
    error: [400, 'UnsupportedCurrencyAmountInOfferToPay'],
    requested: [],
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: makeOffer({networks: ['regtest']}),
    },
    derived: [],
    description: 'An offer for another network has no payer key derived',
    error: [400, 'ExpectedOfferForNetworkToPay'],
    requested: [],
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: makeOffer({expires_at: past}),
    },
    derived: [],
    description: 'An expired offer has no payer key derived',
    error: [400, 'ExpectedUnexpiredOfferToPay'],
    requested: [],
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: makeOffer({max_quantity: 2}),
    },
    derived: [],
    description: 'An offer with a quantity has no payer key derived',
    error: [400, 'ExpectedOfferWithoutQuantityToPay'],
    requested: [],
  },
  {
    args: {offer, lnd: makeTestLnd([invoice, invoice])},
    derived: [],
    description: 'An offer without an amount has no key derived without one',
    error: [400, 'ExpectedMillitokensToPayOfferWithoutAmount'],
    requested: [],
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: makeOffer({mtokens: '5000'}),
    },
    derived: [],
    description: 'An offer paid less than its amount has no key derived',
    error: [400, 'ExpectedAtLeastOfferAmountToPayOffer'],
    requested: [],
  },
  {
    args: {
      mtokens,
      offer,
      bip353_name: 'alice',
      lnd: makeTestLnd([invoice, invoice]),
    },
    derived: [],
    description: 'A name that the offer was found with is user at domain',
    error: [400, 'ExpectedUserAtDomainBip353NameToPayOffer'],
    requested: [],
  },
  {
    args: {
      mtokens,
      offer,
      bip353_name: `${'a'.repeat(256)}@example.com`,
      lnd: makeTestLnd([invoice, invoice]),
    },
    derived: [],
    description: 'A name too long for the request has no payer key derived',
    error: [400, 'ExpectedBip353NamePartsWithinMaximumLengthToEncode'],
    requested: [],
  },
  {
    args: {
      mtokens,
      offer,
      lnd: makeTestLnd([invoice, invoice]),
      payer_note: 1,
    },
    derived: [],
    description: 'A payer note that is not a string has no payer key derived',
    error: [400, 'ExpectedPayerNoteStringToCreateInvoiceRequest'],
    requested: [],
  },
  {
    args: {mtokens, offer, lnd: underived()},
    description: 'A payer key has to be derived to make the request',
    error: [503, 'UnexpectedErrGettingPublicKeyFromSeed', {err: 'err'}],
    requested: [],
  },
  {
    args: {mtokens, offer, lnd: misderived()},
    description: 'A payer key that is derived has to be a public key',
    error: [400, 'ExpectedPayerIdPublicKeyToPayOffer'],
    requested: [],
  },
  {
    args: {mtokens, offer, lnd: unsigned()},
    description: 'The request has to be signed to be sent',
    error: [503, 'UnexpectedErrorWhenSigningBytes', {err: 'err'}],
    requested: [],
  },
  {
    args: {mtokens, offer, lnd: missigned()},
    description: 'The request has to be signed by the payer id key',
    error: [503, 'FailedToCreateSignedInvoiceRequest', {
      err: new Error('ExpectedValidSignatureForSigningPublicKeyToSignStream'),
    }],
    requested: [],
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([refused, invoice])},
    description: 'An invoice error stops trying other paths',
    error: [503, 'OfferInvoiceRequestFailed', {
      erroneous_field: undefined,
      message: 'refused',
    }],
    requested: [1],
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([expired, invoice])},
    description: 'An expired invoice has the next path tried',
    expected: {
      mtokens,
      description: 'thing',
      features: [],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: [],
      paths: [paymentPath],
      payer_key_index: 1,
      requested: [1, 2],
    },
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([expired, unreplied])},
    description: 'A reply that is not a good invoice is given over no reply',
    error: [503, 'ExpectedUnexpiredInvoiceForOffer'],
    requested: [1, 2],
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([unreplied, expired])},
    description: 'A reply that is not a good invoice is returned',
    error: [503, 'ExpectedUnexpiredInvoiceForOffer'],
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([unreplied, unreplied])},
    description: 'Without a reply, the failure of each path is returned',
    error: [503, 'FailedToGetInvoiceForOffer', {failures: [ended, ended]}],
    requested: [1, 2],
  },
  {
    args: {
      mtokens,
      lnd: makeTestLnd([invoice, invoice]),
      offer: unknownEdge(),
    },
    derived: [],
    description: 'A path has to start at a node that can be found',
    error: [503, 'FailedToFindIntroductionNodesOfOfferPaths'],
    requested: [],
  },
  {
    args: {
      mtokens,
      offer,
      lnd: makeTestLnd([edgeInvoice, invoice], edgeChannel),
    },
    description: 'A payment path at an edge starts at its direction node',
    expected: {
      mtokens,
      description: 'thing',
      features: [],
      is_payer_key: true,
      is_signed_by_payer: true,
      names: [],
      paths: [{
        base_fee_mtokens: edgePath.base_fee_mtokens,
        cltv_delta: edgePath.cltv_delta,
        fee_rate: edgePath.fee_rate,
        hops: edgePath.hops,
        introduction_node: edgeNode2,
        key: edgePath.key,
        max_htlc_mtokens: edgePath.max_htlc_mtokens,
        min_htlc_mtokens: edgePath.min_htlc_mtokens,
      }],
      payer_key_index: 1,
      requested: [1],
    },
  },
  {
    args: {mtokens, offer, lnd: makeTestLnd([edgeInvoice, invoice])},
    description: 'A payment path has to start at a node that can be found',
    error: [503, 'FailedToFindStartOfPaymentPathsForOfferInvoice'],
    requested: [1],
  },
];

tests.forEach(({args, derived, description, error, expected, requested}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      deepStrictEqual(await getInvoice(args), expected, 'Got expected result');
    }

    // The payer keys that were derived are checked when they are given
    if (!!derived) {
      deepStrictEqual(keysDerived(args.lnd), derived, 'Got expected derived');
    }

    // The paths that were tried are checked when they are given
    if (!!requested) {
      deepStrictEqual(tried(args.lnd), requested, 'Got expected paths tried');
    }
  });
});
