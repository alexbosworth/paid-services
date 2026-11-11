const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');

const {addServiceLabel} = require('./../../../service_records');

const issuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';

/** Make the offers that the tests of signing support menus share

  The offers are of the issuer of secret 1, with paths that start at the node
  of secret 9. Paths are blinded with random keys, so the offers are made once
  and every test gets the same offers.

  @returns
  {
    first: {
      offer: <First Related Offer String>
    }
    makeOffer: <Make Offer With a Path From an Introduction Function>
    offer: <Support Offer String>
    related: [{
      offer: <Related Offer String>
    }]
    second: {
      offer: <Second Related Offer String>
    }
  }
*/
module.exports = (() => {
  // Make an offer of the issuer of secret 1, a support offer when it has an id
  const makeOffer = ({description, id, introduction}) => {
    const blinded = blindedPathFromHops({hops: [introduction]});

    const {offer} = createOffer({
      description,
      issuer_id: issuer,
      networks: ['regtest'],
      paths: [{
        hops: blinded.path,
        introduction_node: introduction,
        key: blinded.key,
      }],
    });

    // Exit early when the offer is not a support offer
    if (!id) {
      return offer;
    }

    return addServiceLabel({id, offer, type: '1', version: 1}).offer;
  };

  const offer = makeOffer({
    description: 'support',
    id: '0a'.repeat(16),
    introduction: node,
  });

  // Offers with paths are large enough that only a few fit on a page
  const related = Array(6).fill(null).map((n, i) => ({
    offer: makeOffer({description: `offer ${i}`, introduction: node}),
  }));

  const [first, second] = related;

  return {first, makeOffer, offer, related, second};
})();
