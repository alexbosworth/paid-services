const {deepStrictEqual, rejects} = require('node:assert/strict');
const {mock} = require('node:test');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./fixtures/make_invoice');
const makeRequest = require('./fixtures/make_request');
const network = require('./../../network');

const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));
const bufferAsHex = buffer => buffer.toString('hex');
const ended = [503, 'NetworkReplyListenerEnded'];
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const mtokens = '1000';
const node = asKey(9);

// Reply to a request with the reply the fake LND has, noting that it was sent
const fakeReply = ({lnd, message}, cbk) => {
  lnd.sent.push(message.value);

  return lnd.reply(message.value, cbk);
};

// Replies are faked so that no onion messages are sent
mock.method(network, 'requestNetworkReply', fakeReply);

const method = require('./../../offers/request_offer_invoice');

const blinded = blindedPathFromHops({hops: [node]});

const path = {hops: blinded.path, introduction_node: node, key: blinded.key};

// The offer of the issuer of secret 1
const offer = createOffer({
  issuer_id: asKey(1),
  networks: ['bitcoin'],
  paths: [path],
})
.offer;

const request = makeRequest({mtokens, offer, network: 'bitcoin'});

// A payment path to pay an invoice over
const paymentPath = {
  base_fee_mtokens: '1',
  cltv_delta: 40,
  fee_rate: 1,
  hops: blinded.path,
  introduction_node: node,
  key: blinded.key,
  max_htlc_mtokens: '1000000',
  min_htlc_mtokens: '1',
};

const good = makeInvoice({encoded: request.encoded, paths: [paymentPath]});

// A path that ends at the node of a secret, as a path of an offer
const pathTo = n => ({
  hops: [{encrypted_data: '00', relay_key: asKey(n)}],
  introduction_node: node,
  key: asKey(7),
});

// An offer without an issuer id, with paths that end at nodes 5 and 6
const unissued = createOffer({
  networks: ['bitcoin'],
  paths: [pathTo(5), pathTo(6)],
})
.offer;

const unissuedRequest = makeRequest({
  mtokens,
  network: 'bitcoin',
  offer: unissued,
});

// An invoice for the request to the offer without an issuer id, from node 6
const fromNodeSix = makeInvoice({
  encoded: unissuedRequest.encoded,
  node_id: asKey(6),
  paths: [paymentPath],
  secret: bufferAsHex(Buffer.alloc(32, 6)),
});

const expired = makeInvoice({
  created_at: '2024-12-31T00:00:00.000Z',
  encoded: request.encoded,
  expires_at: '2025-01-01T00:00:00.000Z',
  paths: [paymentPath],
});

const refusal = createInvoiceError({message: 'refused'}).encoded;

// The recipient replies with a message of a type
const replyWith = (type, value) => ({}, cbk) => {
  return cbk(null, {reply: {type, value}});
};

// Make a fake LND that replies to a request
const makeLnd = reply => ({reply, sent: []});

// Summarize a reply by the messages of its errors and its invoice
const summary = reply => {
  const err = !!reply.err ? {err: reply.err[1]} : {};
  const error = !!reply.error ? {error: reply.error[1]} : {};
  const invoice = !!reply.invoice ? {invoice: reply.invoice.invoice} : {};
  const isReply = !!reply.is_reply ? {is_reply: true} : {};

  return {...err, ...error, ...invoice, ...isReply};
};

// Request an invoice and see what replies there are and if a request was sent
const requestInvoice = async args => {
  const replies = await method(args);

  return {replies: replies.map(summary), sent: args.lnd.sent.length};
};

// Make arguments to request an invoice
const makeArgs = ({replies, reply}) => ({
  path,
  request,
  lnd: makeLnd(reply),
  peers: [],
  replies: replies || [],
  timeout: 1,
});

const tests = [
  {
    args: {...makeArgs({}), lnd: undefined},
    description: 'LND is expected',
    error: [400, 'ExpectedLndToRequestOfferInvoice'],
  },
  {
    args: {...makeArgs({}), path: undefined},
    description: 'An offer path is expected',
    error: [400, 'ExpectedOfferPathToRequestOfferInvoice'],
  },
  {
    args: {...makeArgs({}), peers: undefined},
    description: 'Peers are expected',
    error: [400, 'ExpectedPeersToRequestOfferInvoice'],
  },
  {
    args: {...makeArgs({}), replies: undefined},
    description: 'Replies are expected',
    error: [400, 'ExpectedRepliesToRequestOfferInvoice'],
  },
  {
    args: {...makeArgs({}), request: undefined},
    description: 'An invoice request is expected',
    error: [400, 'ExpectedInvoiceRequestToRequestOfferInvoice'],
  },
  {
    args: {...makeArgs({}), timeout: undefined},
    description: 'A timeout is expected',
    error: [400, 'ExpectedTimeoutToRequestOfferInvoice'],
  },
  {
    args: makeArgs({reply: replyWith('66', good.encoded)}),
    description: 'An invoice is added to the replies',
    expected: {replies: [{invoice: good.invoice}], sent: 1},
  },
  {
    args: makeArgs({reply: replyWith('68', refusal)}),
    description: 'An invoice error is added to the replies',
    expected: {replies: [{error: 'OfferInvoiceRequestFailed'}], sent: 1},
  },
  {
    args: makeArgs({reply: replyWith('66', expired.encoded)}),
    description: 'A reply that is not a good invoice is a failure',
    expected: {
      replies: [{err: 'ExpectedUnexpiredInvoiceForOffer', is_reply: true}],
      sent: 1,
    },
  },
  {
    args: {
      ...makeArgs({reply: replyWith('66', fromNodeSix.encoded)}),
      path: pathTo(5),
      request: unissuedRequest,
    },
    description: 'An invoice from the end of another path is a failure',
    expected: {
      replies: [{
        err: 'ExpectedInvoiceSignedByFinalNodeOfOfferPathUsed',
        is_reply: true,
      }],
      sent: 1,
    },
  },
  {
    args: {
      ...makeArgs({reply: replyWith('66', fromNodeSix.encoded)}),
      path: pathTo(6),
      request: unissuedRequest,
    },
    description: 'An invoice from the end of the path sent over is added',
    expected: {replies: [{invoice: fromNodeSix.invoice}], sent: 1},
  },
  {
    args: makeArgs({reply: ({}, cbk) => cbk(ended)}),
    description: 'No reply is a failure',
    expected: {replies: [{err: 'NetworkReplyListenerEnded'}], sent: 1},
  },
  {
    args: makeArgs({
      replies: [{err: ended}],
      reply: replyWith('66', good.encoded),
    }),
    description: 'A reply is added after the replies over other paths',
    expected: {
      replies: [{err: 'NetworkReplyListenerEnded'}, {invoice: good.invoice}],
      sent: 1,
    },
  },
  {
    args: makeArgs({
      replies: [{error: [503, 'OfferInvoiceRequestFailed', {}]}],
      reply: replyWith('66', good.encoded),
    }),
    description: 'No request is sent after the recipient answered',
    expected: {replies: [{error: 'OfferInvoiceRequestFailed'}], sent: 0},
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      deepStrictEqual(await requestInvoice(args), expected, 'Got result');
    }
  });
});
