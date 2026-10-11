const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {mock} = require('node:test');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {getPublicKey} = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {parseInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const makeInvoice = require('./fixtures/make_invoice');
const network = require('./../../network');
const {payerKeyFamily} = require('./../../offers/constants');

const bufferAsHex = buffer => buffer.toString('hex');
const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));
const compareKeys = (a, b) => Buffer.compare(hexAsBuffer(a), hexAsBuffer(b));
const derivedBefore = [{key_family: payerKeyFamily, key_index: 0}];
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const ended = [503, 'NetworkReplyListenerEnded'];
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const mtokens = '1000';
const node = asKey(9);
const notFound = {details: 'edge not found'};
const outpoint = `${bufferAsHex(Buffer.alloc(32))}:0`;
const past = '2025-01-01T00:00:00.000Z';
const sha256 = n => createHash('sha256').update(n).digest();

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

// Two offer paths, which each have their own key
const [first, second] = [node, node].map(hop => {
  const {key, path} = blindedPathFromHops({hops: [hop]});

  return {key, hops: path, introduction_node: hop};
});

// The offer paths by their number
const pathNumbers = {[first.key]: 1, [second.key]: 2};

// The issuer of the offers is the node of secret 1
const issuer = asKey(1);

// Make an offer of the issuer of secret 1 with the two offer paths
const makeOffer = args => createOffer({
  description: 'thing',
  issuer_id: issuer,
  networks: ['bitcoin'],
  paths: [first, second],
  ...args,
})
.offer;

// The offer of the issuer of secret 1
const offer = makeOffer({});

// An offer of the issuer of secret 1 that has no paths
const issuerOnly = createOffer({
  description: 'thing',
  issuer_id: issuer,
  networks: ['bitcoin'],
})
.offer;

// A payment path to pay an invoice over
const paymentPath = {
  base_fee_mtokens: '1',
  cltv_delta: 40,
  fee_rate: 1,
  hops: first.hops,
  introduction_node: node,
  key: first.key,
  max_htlc_mtokens: '1000000',
  min_htlc_mtokens: '1',
};

// A payment path that starts at direction 1 of a channel edge
const edgePath = {
  base_fee_mtokens: paymentPath.base_fee_mtokens,
  cltv_delta: paymentPath.cltv_delta,
  fee_rate: paymentPath.fee_rate,
  hops: paymentPath.hops,
  introduction_edge: '1x1x1x1',
  key: paymentPath.key,
  max_htlc_mtokens: paymentPath.max_htlc_mtokens,
  min_htlc_mtokens: paymentPath.min_htlc_mtokens,
};

// The nodes of the channel of the edge, the lesser key first
const [edgeNode1, edgeNode2] = [asKey(2), asKey(3)].sort(compareKeys);

// The channel of the edge, with the greater node key listed first
const edgeChannel = {
  capacity: '1',
  chan_point: outpoint,
  channel_id: '1',
  node1_pub: edgeNode2,
  node2_pub: edgeNode1,
};

// The recipient replies with an invoice for the request over payment paths
const replyWith = (paths, features) => (encoded, cbk) => {
  const {encoded: value} = makeInvoice({encoded, features, paths});

  return cbk(null, {reply: {value, type: '66'}});
};

// The recipient replies with an invoice for the request
const invoice = replyWith([paymentPath]);

// The recipient replies with an invoice to pay over a channel edge
const edgeInvoice = replyWith([edgePath]);

// The recipient replies with an invoice that has an invoice feature
const featured = replyWith([paymentPath], [{bit: 17}]);

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

// The fake LND has a secret key at every key locator, made from the locator
const secretAt = ({key_family, key_index}) => {
  return sha256(Buffer.from(`${key_family}:${key_index}`));
};

// The public key at a key locator, as LND answers for the locator
const keyAt = locator => ({
  key_loc: locator,
  raw_key_bytes: keyOf(secretAt(locator)),
});

// Sign the tagged hash of a message with the key at a locator, as LND does
const signMessage = ({key_loc, msg, tag}, cbk) => {
  const tagHash = sha256(tag);

  const hash = sha256(Buffer.concat([tagHash, tagHash, msg]));

  return cbk(null, {
    signature: Buffer.from(signSchnorr(hash, secretAt(key_loc))),
  });
};

// Make a fake LND with replies to requests over the first and second paths,
// that knows of a channel when it is given, and that derives and signs with
// keys at key locators
const makeTestLnd = ([toFirst, toSecond], channel) => {
  const lnd = makeLnd({});

  lnd.default.getChanInfo = ({}, cbk) => {
    return cbk(!channel ? notFound : null, channel);
  };
  lnd.default.listPeers = ({}, cbk) => cbk(null, {peers: []});
  lnd.replies = {[first.key]: toFirst, [second.key]: toSecond};
  lnd.requested = [];
  lnd.sent = [];
  lnd.signer = {signMessage};
  lnd.wallet.deriveKey = (locator, cbk) => cbk(null, keyAt(locator));

  // A request sent to the issuer over a path made to it gets the first reply
  lnd.replies[issuer] = toFirst;

  // The keys that are derived for the request
  lnd.derived = [];

  // The next key in a family is the one after the keys derived in it so far,
  // and a payer key was derived before, so the next payer key is at index 1
  lnd.wallet.deriveNextKey = ({key_family}, cbk) => {
    const keys = [].concat(derivedBefore).concat(lnd.derived);

    const inFamily = keys.filter(n => n.key_family === key_family);

    const locator = {key_family, key_index: inFamily.length};

    lnd.derived.push(locator);

    return cbk(null, keyAt(locator));
  };

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

  lnd.wallet.deriveNextKey = ({key_family}, cbk) => cbk(null, {
    key_loc: {key_family, key_index: 1},
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

  lnd.signer.signMessage = ({msg, tag}, cbk) => {
    const other = {key_family: payerKeyFamily, key_index: 99};

    return signMessage({msg, tag, key_loc: other}, cbk);
  };

  return lnd;
};

// The payer keys that were derived for the request, by their key index
const keysDerived = lnd => lnd.derived.map(n => n.key_index);

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

// An offer whose only path starts at a channel edge that is not known
const unknownEdge = createOffer({
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
    args: {mtokens, offer, lnd: makeTestLnd([invoice, invoice]), payer_note: 1},
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
    description: 'A reply that is not a good invoice is returned over no reply',
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
    args: {mtokens, lnd: makeTestLnd([invoice, invoice]), offer: unknownEdge},
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
