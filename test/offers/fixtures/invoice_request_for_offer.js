const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const bufferAsHex = buffer => buffer.toString('hex');
const keyOf = secret => Buffer.from(pointFromScalar(secret));
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';

/** Make the offers that the tests of making invoice requests share

  The offers are of the issuer of secret 1, with paths from the node of secret
  9. Paths are blinded with random keys, so the offers are made once and every
  test gets the same offers and paths.

  @returns
  {
    amountless: <Offer Without an Amount String>
    currency: <Offer With an Amount in a Currency String>
    issuerOnly: <Offer With an Issuer Id and No Paths Object>
    makeOffer: <Make an Offer of the Issuer of Secret 1 Function>
    paths: [<Path of the Offers Object>]
    priced: <Offer With an Amount String>
  }
*/
module.exports = (() => {
  // Get the public key of a secret of 32 bytes of a number
  const asKey = n => bufferAsHex(keyOf(Buffer.alloc(32, n)));

  const blinded = blindedPathFromHops({hops: [node]});

  // The path of the offers, from the node of secret 9
  const paths = [{
    hops: blinded.path,
    introduction_node: node,
    key: blinded.key,
  }];

  // Make an offer of the issuer of secret 1 with blinded paths
  const makeOffer = args => createOffer({
    paths,
    issuer_id: asKey(1),
    networks: ['regtest'],
    ...args,
  })
  .offer;

  // An offer without an amount, and one with an amount
  const amountless = makeOffer({});
  const priced = makeOffer({description: 'thing', mtokens: '5000'});

  // An offer with an amount in a currency
  const currency = makeOffer({
    amount: '100',
    currency: 'USD',
    description: 'x',
  });

  // An offer with an issuer id and no paths
  const issuerOnly = createOffer({issuer_id: asKey(1), networks: ['regtest']});

  return {amountless, currency, issuerOnly, makeOffer, paths, priced};
})();
