const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const {addServiceLabel} = require('./../../service_records');
const {decodeRecords} = require('./../../service_records');
const isSupportOffer = require('./../../support/is_support_offer');
const method = require('./../../support/offer_bitcoin_network');

const issuer = '031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';
const networks = ['bitcoin', 'regtest', 'signet', 'testnet', 'testnet4'];
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';
const regtest = '06226e46111a0b59caaf126043eb5bbf28c34f3a5e332a1fc7b2b73cf188910f';

// Make a support offer for networks, with a path from the node of secret 9
const supportOffer = networks => {
  const blinded = blindedPathFromHops({hops: [node]});

  const {offer} = createOffer({
    networks,
    description: 'support',
    issuer_id: issuer,
    paths: [{hops: blinded.path, introduction_node: node, key: blinded.key}],
  });

  return addServiceLabel({offer, id: '0d'.repeat(16), type: '1', version: 1})
    .offer;
};

// Change the chains of an offer
const withChains = (offer, chains) => {
  const {records} = decodeRecords({encoded: parseOffer({offer}).encoded});

  const {encoded} = encodeTlvStream({
    records: records.filter(n => n.type !== '2').concat({
      type: '2',
      value: chains.join(''),
    }),
  });

  return parseOffer({encoded}).offer;
};

// Get the network of an offer, and whether it can be a support offer
const read = ({offer}) => ({
  ...method({offer}),
  is_support_offer: isSupportOffer({offer}).is_support_offer,
});

const tests = [
  {
    args: {offer: supportOffer()},
    description: 'An offer without chains is for bitcoin',
    expected: {is_support_offer: true, network: 'bitcoin'},
  },
  ...networks.map(network => ({
    args: {offer: supportOffer([network])},
    description: `An offer for ${network} is for one Bitcoin network`,
    expected: {network, is_support_offer: true},
  })),
  {
    args: {offer: supportOffer(['regtest', 'testnet'])},
    description: 'An offer for two networks has no one network',
    expected: {is_support_offer: false},
  },
  {
    // Readers that only know Bitcoin networks would see only regtest
    args: {offer: withChains(supportOffer(), [regtest, '01'.repeat(32)])},
    description: 'An offer for a network and another chain has no network',
    expected: {is_support_offer: false},
  },
  {
    args: {offer: 'offer'},
    description: 'Something that is not an offer has no network',
    expected: {is_support_offer: false},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(read(args), expected, 'Got expected result');
  });
});
