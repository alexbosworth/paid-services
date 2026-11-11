const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');

const {addServiceLabel} = require('./../../../service_records');

const issuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';
const other = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const otherNode = '03f991f944d1e1954a7fc8b9bf62e0d78f015f4c07762d505e20e6c45260a3661b';
const version = 1;

/** Make the offers that the tests of getting a support menu share, and the
  helpers that make more of them

  Offers are of the issuer of secret 1 unless they are of the other issuer of
  secret 2, with a path from the node of secret 9. Paths are blinded with
  random keys, so these are made once and every test gets the same ones.

  @returns
  {
    episode: <Support Offer That Can Be Listed on a Menu String>
    forNetworks: <Make an Offer of the Issuer For Networks Function>
    guest: <Offer of the Other Issuer String>
    label: <Make an Offer With a Path, Labeled as a Support Offer Function>
    labeled: <Make an Offer With a Label of a Type and Version Function>
    ownPaths: <Offer With a Path of Its Own From the Node of Secret 8 String>
    paths: [<Offer Path Object>]
    plain: <Offer of the Issuer Without Paths String>
    reached: <Offer Reached Over the Paths of the Support Offer String>
    regtest: <Offer on Regtest String>
    regtestAndTestnet: <Offer on Regtest and Testnet String>
    supportOffer: <Support Offer That the Menu Is Of String>
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

  // Make an offer with a path, labeled as a support offer
  const label = args => addServiceLabel({
    version,
    id: '0d'.repeat(16),
    offer: createOffer({paths, networks: ['regtest'], ...args}).offer,
    type: '1',
  })
  .offer;

  // Make an offer of the issuer with a label of a service type and version
  const labeled = (type, major) => addServiceLabel({
    type,
    id: '0d'.repeat(16),
    offer: createOffer({
      paths,
      issuer_id: issuer,
      networks: ['regtest'],
    })
    .offer,
    version: major,
  })
  .offer;

  // Make an offer of the issuer for networks
  const forNetworks = networks => createOffer({
    networks,
    description: String(networks),
    issuer_id: issuer,
  })
  .offer;

  const supportOffer = label({description: 'support', issuer_id: issuer});

  // Offers that can be listed on a menu
  const episode = label({description: 'episode', issuer_id: issuer});
  const guest = createOffer({
    description: 'guest',
    issuer_id: other,
    networks: ['regtest'],
  })
  .offer;
  const plain = createOffer({issuer_id: issuer, networks: ['regtest']}).offer;
  const regtest = forNetworks(['regtest']);
  const regtestAndTestnet = forNetworks(['regtest', 'testnet']);

  // An offer of the issuer with paths of its own, and as it is reached over
  // the paths of the support offer when it is listed without its paths
  const otherPath = blindedPathFromHops({hops: [otherNode]});

  const ownPaths = createOffer({
    description: 'episode',
    issuer_id: issuer,
    networks: ['regtest'],
    paths: [{
      hops: otherPath.path,
      introduction_node: otherNode,
      key: otherPath.key,
    }],
  })
  .offer;

  const reached = createOffer({
    paths,
    description: 'episode',
    issuer_id: issuer,
    networks: ['regtest'],
  })
  .offer;

  return {
    episode,
    forNetworks,
    guest,
    label,
    labeled,
    ownPaths,
    paths,
    plain,
    reached,
    regtest,
    regtestAndTestnet,
    supportOffer,
  };
})();
