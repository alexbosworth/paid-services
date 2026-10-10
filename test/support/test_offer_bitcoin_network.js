const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../service_records');
const {decodeRecords} = require('./../../service_records');
const isSupportOffer = require('./../../support/is_support_offer');
const method = require('./../../support/offer_bitcoin_network');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)));
const node = asKey(9).toString('hex');
const blinded = blindedPathFromHops({hops: [node]});
const {key} = blinded;
const paths = [{key, hops: blinded.path, introduction_node: node}];
const regtest =
  '06226e46111a0b59caaf126043eb5bbf28c34f3a5e332a1fc7b2b73cf188910f';

// Make a support offer for networks
const supportOffer = networks => addServiceLabel({
  id: '0d'.repeat(16),
  offer: createOffer({
    networks,
    paths,
    description: 'support',
    issuer_id: asKey(1).toString('hex'),
  })
  .offer,
  type: '1',
  version: 1,
})
.offer;

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

const networks = ['bitcoin', 'regtest', 'signet', 'testnet', 'testnet4'];

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
