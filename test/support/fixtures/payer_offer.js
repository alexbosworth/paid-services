const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');

const {addServiceLabel} = require('./../../../service_records');

const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';
const supportIssuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';

/** Make the paths and the support offer that the payer offer tests share

  The support offer is of the key of secret 1, with a path from the node of
  secret 9. Paths are blinded with random keys, so these are made once and
  every test gets the same ones.

  @returns
  {
    paths: [<Offer Path Object>]
    support: <Support Offer That Is Paid String>
  }
*/
module.exports = (() => {
  const blinded = blindedPathFromHops({hops: [node]});

  // The paths of offers, from the node of secret 9
  const paths = [{
    hops: blinded.path,
    introduction_node: node,
    key: blinded.key,
  }];

  // The support offer that is paid, made by the key of secret 1
  const support = addServiceLabel({
    id: '0d'.repeat(16),
    offer: createOffer({
      paths,
      description: 'support',
      issuer_id: supportIssuer,
    })
    .offer,
    type: '1',
    version: 1,
  })
  .offer;

  return {paths, support};
})();
