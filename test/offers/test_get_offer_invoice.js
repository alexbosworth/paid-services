const {deepStrictEqual, rejects} = require('node:assert/strict');
const {mock} = require('node:test');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {makeLnd} = require('mock-lnd');
const {parseInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./fixtures/make_invoice');
const network = require('./../../network');

const bufferAsHex = buffer => buffer.toString('hex');
const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const ended = [503, 'NetworkReplyListenerEnded'];
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const mtokens = '1000';
const node = asKey(9);
const past = '2025-01-01T00:00:00.000Z';

// Reply to a request with the reply the fake LND has for the path
const fakeReply = ({lnd, message, path}, cbk) => {
  lnd.requested.push(path.key);
  lnd.sent.push(message.value);

  return lnd.replies[path.key](message.value, cbk);
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

// The offer of the issuer of secret 1
const offer = createOffer({
  issuer_id: asKey(1),
  networks: ['bitcoin'],
  paths: [first, second],
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

// The recipient replies with an invoice for the request
const invoice = (encoded, cbk) => {
  const {encoded: value} = makeInvoice({encoded, paths: [paymentPath]});

  return cbk(null, {reply: {value, type: '66'}});
};

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

// Make a fake LND with replies to requests over the first and second paths
const makeTestLnd = ([toFirst, toSecond]) => {
  const lnd = makeLnd({});

  lnd.default.getChanInfo = ({}, cbk) => cbk({details: 'edge not found'});
  lnd.default.listPeers = ({}, cbk) => cbk(null, {peers: []});
  lnd.replies = {[first.key]: toFirst, [second.key]: toSecond};
  lnd.requested = [];
  lnd.sent = [];

  return lnd;
};

// The paths that requests were sent over, by their number
const tried = lnd => lnd.requested.map(key => key === first.key ? 1 : 2);

// Get an invoice and see what it is like and which paths were tried
const getInvoice = async args => {
  const got = await method(args);

  const payerKey = keyOf(hexAsBuffer(got.payer_secret));

  // The requests that were sent have the name the offer was found with
  const names = args.lnd.sent.map(encoded => {
    return parseInvoiceRequest({encoded}).bip353_name;
  });

  return {
    is_payer_key: bufferAsHex(payerKey) === got.payer_id,
    mtokens: got.mtokens,
    names: names.filter(n => !!n),
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
    description: 'An invoice is returned with the key of the payer',
    expected: {is_payer_key: true, mtokens, names: [], requested: [1]},
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
      is_payer_key: true,
      names: ['alice@example.com'],
      requested: [1],
    },
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
    expected: {is_payer_key: true, mtokens, names: [], requested: [1, 2]},
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
    description: 'A path has to start at a node that can be found',
    error: [503, 'FailedToFindIntroductionNodesOfOfferPaths'],
    requested: [],
  },
];

tests.forEach(({args, description, error, expected, requested}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      deepStrictEqual(await getInvoice(args), expected, 'Got expected result');
    }

    // The paths that were tried are checked when they are given
    if (!!requested) {
      deepStrictEqual(tried(args.lnd), requested, 'Got expected paths tried');
    }
  });
});
