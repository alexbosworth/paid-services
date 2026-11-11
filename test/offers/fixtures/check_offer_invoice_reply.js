const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./make_invoice');
const makeRequest = require('./make_request');

const bufferAsHex = buffer => buffer.toString('hex');
const createdAt = '2025-01-01T00:00:00.000Z';
const expiresAt = '2100-01-01T00:00:00.000Z';
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const mtokens = '1000';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';

/** Make the offers, requests and invoices that the tests of checking replies
  to invoice requests share

  The offer of the issuer of secret 1 has a path from the node of secret 9.
  Paths are blinded with random keys, so these are made once and every test
  gets the same ones.

  @returns
  {
    featured: <Invoice For the Request With an Invoice Feature Object>
    fromNodeSix: <Invoice From Node 6 For the Unissued Request Object>
    good: <Invoice For the Request Object>
    invoiceFor: <Make an Invoice For a Request Function>
    other: <Request For the Offer of Another Amount Object>
    path: <Path of the Offer Object>
    pathTo: <Make a Path to the Node of a Secret Function>
    paymentPath: <Payment Path to Pay Invoices Over Object>
    request: <Request For the Offer Object>
    unissuedRequest: <Request For an Offer Without an Issuer Id Object>
  }
*/
module.exports = (() => {
  // Get the public key of a secret of 32 bytes of a number
  const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));

  const blinded = blindedPathFromHops({hops: [node]});

  // The path of the offer, that requests are sent over
  const path = {hops: blinded.path, introduction_node: node, key: blinded.key};

  // The offer of the issuer of secret 1
  const offer = createOffer({
    issuer_id: asKey(1),
    networks: ['bitcoin'],
    paths: [path],
  })
  .offer;

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

  // A request for the offer, and a request for the offer of another amount
  const request = makeRequest({mtokens, offer, network: 'bitcoin'});

  const other = makeRequest({offer, mtokens: '2000', network: 'bitcoin'});

  // An invoice for a request
  const invoiceFor = ({encoded}, args) => makeInvoice({
    encoded,
    created_at: createdAt,
    expires_at: expiresAt,
    paths: [paymentPath],
    ...args,
  });

  const good = invoiceFor(request);

  // An invoice for the request that has an invoice feature
  const featured = invoiceFor(request, {features: [{bit: 17}]});

  // A request for the offer without an issuer id
  const unissuedRequest = makeRequest({
    mtokens,
    network: 'bitcoin',
    offer: unissued,
  });

  // An invoice for the request to the offer without an issuer id, from node 6
  const fromNodeSix = invoiceFor(unissuedRequest, {
    node_id: asKey(6),
    secret: bufferAsHex(Buffer.alloc(32, 6)),
  });

  return {
    featured,
    fromNodeSix,
    good,
    invoiceFor,
    other,
    path,
    pathTo,
    paymentPath,
    request,
    unissuedRequest,
  };
})();
