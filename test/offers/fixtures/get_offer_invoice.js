const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const makeInvoice = require('./make_invoice');

const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';

/** Make the paths, offers and replies that the tests of getting an invoice for
  an offer share

  The offers are of the issuer of secret 1, with paths from the node of secret
  9. Paths are blinded with random keys, so these are made once and every test
  gets the same ones.

  @returns
  {
    edgeChannel: <Channel of the Edge of the Edge Path Object>
    edgeInvoice: <Reply With an Invoice Over the Edge Path Function>
    edgeNode2: <Greater Node Public Key of the Edge Hex String>
    edgePath: <Payment Path Starting at a Channel Edge Object>
    featured: <Reply With an Invoice That Has a Feature Function>
    first: <First Offer Path Object>
    fromPayer: <Offer Path Starting at the Payer Object>
    fromPayerOffer: <Offer With the Path From the Payer String>
    invoice: <Reply With an Invoice Function>
    issuer: <Issuer Public Key Hex String>
    issuerOnly: <Offer Without Paths Object>
    makeOffer: <Make an Offer of the Issuer Function>
    offer: <Offer With the Two Paths String>
    pathNumbers: <Offer Path Numbers By Path Key Object>
    paymentPath: <Payment Path Object>
    second: <Second Offer Path Object>
  }
*/
module.exports = (() => {
  // Get the public key of a secret of 32 bytes of a number
  const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));

  // Compare public keys by their bytes
  const compareKeys = (a, b) => Buffer.compare(hexAsBuffer(a), hexAsBuffer(b));

  // The payer is the node of secret 4
  const payer = asKey(4);

  // Make an offer path through hops, which starts at the first hop
  const makePath = hops => {
    const [introduction] = hops;

    const {key, path} = blindedPathFromHops({hops});

    return {key, hops: path, introduction_node: introduction};
  };

  // Two offer paths, which each have their own key
  const [first, second] = [[node], [node]].map(makePath);

  // An offer path that starts at the payer
  const fromPayer = makePath([payer, node]);

  // The offer paths by their number
  const pathNumbers = {[first.key]: 1, [second.key]: 2, [fromPayer.key]: 3};

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

  // An offer of the issuer with a path that starts at the payer
  const fromPayerOffer = makeOffer({paths: [fromPayer]});

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

  // The channel of the edge, as the graph has it
  const edgeChannel = {
    id: '1x1x1',
    policies: [{public_key: edgeNode1}, {public_key: edgeNode2}],
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

  return {
    edgeChannel,
    edgeInvoice,
    edgeNode2,
    edgePath,
    featured,
    first,
    fromPayer,
    fromPayerOffer,
    invoice,
    issuer,
    issuerOnly,
    makeOffer,
    offer,
    pathNumbers,
    paymentPath,
    second,
  };
})();
