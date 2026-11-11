const {blindedPathFromHops} = require('bolt04');
const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./make_invoice');
const makeRequest = require('./make_request');

const bufferAsHex = buffer => buffer.toString('hex');
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const mtokens = '1000';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';

/** Make the requests, invoices and replies that the tests of requesting an
  invoice for an offer share

  The offer of the issuer of secret 1 has a path from the node of secret 9.
  Paths are blinded with random keys, so these are made once and every test
  gets the same ones.

  @returns
  {
    expired: <Invoice For the Request That Expired Object>
    fromNodeSix: <Invoice From Node 6 For the Unissued Request Object>
    good: <Invoice For the Request Object>
    path: <Path of the Offer Object>
    pathTo: <Make a Path to the Node of a Secret Function>
    refusal: <Invoice Error Refusing the Request Hex String>
    request: <Request For the Offer Object>
    unissuedRequest: <Request For an Offer Without an Issuer Id Object>
  }
*/
module.exports = (() => {
  // Get the public key of a secret of 32 bytes of a number
  const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));

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

  return {
    expired,
    fromNodeSix,
    good,
    path,
    pathTo,
    refusal,
    request,
    unissuedRequest,
  };
})();
