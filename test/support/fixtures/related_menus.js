const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');

const {addServiceLabel} = require('./../../../service_records');

const issuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';
const otherIssuer = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';

/** Make the offers that the tests of related menus share

  The offers are of the issuer of secret 1 unless they are of the issuer of
  secret 2, with a path from the node of secret 9. Paths are blinded with
  random keys, so the offers are made once and every test gets the same ones.

  @returns
  {
    clip: <Support Offer String>
    episode: <Support Offer String>
    guest: <Offer of the Other Issuer String>
    level: [<Support Offer For a Level of Related Menus String>]
    other: <Support Offer of the Other Issuer String>
    support: <Support Offer String>
    testnet: <Offer on Testnet String>
    tip: <Offer String>
  }
*/
module.exports = (() => {
  const blinded = blindedPathFromHops({hops: [node]});

  // The paths of the offers, from the node of secret 9
  const paths = [{
    hops: blinded.path,
    introduction_node: node,
    key: blinded.key,
  }];

  // Make an offer of the issuer, labeled as a support offer when it has an id
  const makeOffer = args => {
    const {offer} = createOffer({
      paths,
      description: args.description,
      issuer_id: args.issuer_id || issuer,
    });

    // Exit early when the offer is not a support offer
    if (!args.id) {
      return offer;
    }

    return addServiceLabel({offer, id: args.id, type: '1', version: 1}).offer;
  };

  const support = makeOffer({description: 'support', id: '0d'.repeat(16)});

  const clip = makeOffer({description: 'clip', id: '0f'.repeat(16)});
  const episode = makeOffer({description: 'episode', id: '0e'.repeat(16)});
  const guest = makeOffer({description: 'guest', issuer_id: otherIssuer});
  const other = makeOffer({id: '0e'.repeat(16), issuer_id: otherIssuer});
  const tip = makeOffer({description: 'tip'});

  const testnet = createOffer({
    paths,
    description: 'testnet',
    issuer_id: issuer,
    networks: ['testnet'],
  })
  .offer;

  // Support offers of the issuer for levels of related menus
  const level = [1, 2, 3, 4, 5].map(n => makeOffer({
    description: `level ${n}`,
    id: Buffer.alloc(16, n).toString('hex'),
  }));

  return {clip, episode, guest, level, other, support, testnet, tip};
})();
