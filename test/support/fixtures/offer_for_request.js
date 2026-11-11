const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');

const issuerId = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const pathId = '03'.repeat(32);

/** Make the offers that the tests of matching requests to offers share

  The offers are of the issuer of secret 1, on a path to the issuer with a path
  id of 32 bytes of 0x03. The path is blinded with random keys, so the offers
  are made once and every test gets the same offers.

  @returns
  {
    amountless: <Offer Without an Amount, Like a Support Offer String>
    makeOffer: <Make an Offer of the Issuer on the Path Function>
    offer: <Offer With an Amount String>
  }
*/
module.exports = (() => {
  const path = blindedPathFromHops({hops: [issuerId], id: pathId});

  // Make an offer of the issuer on the path
  const makeOffer = ({description, mtokens}) => createOffer({
    description,
    mtokens,
    issuer_id: issuerId,
    networks: ['regtest'],
    paths: [{hops: path.path, introduction_node: issuerId, key: path.key}],
  })
  .offer;

  // An offer with an amount, and one without, like a support offer
  const amountless = makeOffer({description: 'support'});
  const offer = makeOffer({description: 'description', mtokens: '1000'});

  return {amountless, makeOffer, offer};
})();
