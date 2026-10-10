const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {addServiceLabel} = require('./../../service_records');
const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const method = require('./../../support/related_menus');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const expiresAt = '2100-01-01T00:00:00.000Z';
const issuer = asKey(1);
const node = asKey(9);

const blinded = blindedPathFromHops({hops: [node]});
const {key} = blinded;
const paths = [{key, hops: blinded.path, introduction_node: node}];

// Make an offer of the issuer, labeled as a support offer when it has an id
const makeOffer = ({description, id, issuer_id}) => {
  const offer = createOffer({
    description,
    paths,
    issuer_id: issuer_id || issuer,
  })
  .offer;

  if (!id) {
    return offer;
  }

  return addServiceLabel({id, offer, type: '1', version: 1}).offer;
};

const support = makeOffer({description: 'support', id: '0d'.repeat(16)});

const clip = makeOffer({description: 'clip', id: '0f'.repeat(16)});
const episode = makeOffer({description: 'episode', id: '0e'.repeat(16)});
const guest = makeOffer({description: 'guest', issuer_id: asKey(2)});
const other = makeOffer({id: '0e'.repeat(16), issuer_id: asKey(2)});
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

// Nest offers so that the menu of each lists the one before it
const nest = offers => offers.reduce((related, offer) => {
  return [{offer, related}];
},
[]);

// Make the menus of the support offer and of its related support offers
const make = ({related}) => method({
  related,
  expires_at: expiresAt,
  issuer_id: issuer,
  offer: support,
});

// An offer entry in a menu that has no paths of its own
const unpathed = offer => ({offer, is_without_paths: true});

const tests = [
  {
    args: {
      related: [
        {offer: episode, related: [{offer: clip, related: [{offer: tip}]}]},
        {offer: guest},
        {bip353_name: 'guest@example.com', issuer_id: asKey(2)},
      ],
    },
    description: 'Related support offers of the issuer can have menus',
    expected: {
      answered: [episode, clip, tip],
      menus: [
        {
          entries: [
            {offer: episode, is_without_paths: true},
            {offer: guest},
            {
              bip353_name: 'guest@example.com',
              issuer_id: asKey(2),
              service_id: undefined,
              service_sequence: undefined,
            },
          ],
          offer: support,
        },
        {entries: [{offer: clip, is_without_paths: true}], offer: episode},
        {entries: [{offer: tip, is_without_paths: true}], offer: clip},
      ],
    },
  },
  {
    args: {},
    description: 'A support offer without related offers has an empty menu',
    expected: {answered: [], menus: [{entries: [], offer: support}]},
  },
  {
    args: {related: nest(level.slice(0, 4))},
    description: 'Related menus can be four levels deep',
    expected: {
      answered: [level[3], level[2], level[1], level[0]],
      menus: [
        {entries: [unpathed(level[3])], offer: support},
        {entries: [unpathed(level[2])], offer: level[3]},
        {entries: [unpathed(level[1])], offer: level[2]},
        {entries: [unpathed(level[0])], offer: level[1]},
        {entries: [], offer: level[0]},
      ],
    },
  },
  {
    args: {related: nest(level)},
    description: 'Related menus are not nested more than four levels deep',
    error: 'ExpectedFewerLevelsOfRelatedMenus',
  },
  {
    args: {related: [{offer: tip, related: []}]},
    description: 'An offer that is not a support offer has no menu',
    error: 'ExpectedRelatedMenuOnlyForAnsweredSupportOffer',
  },
  {
    args: {related: [{offer: other, related: []}]},
    description: 'A support offer of another issuer has no menu here',
    error: 'ExpectedRelatedMenuOnlyForAnsweredSupportOffer',
  },
  {
    args: {related: [{bip353_name: 'a@b.c', issuer_id: issuer, related: []}]},
    description: 'A reference has no menu here',
    error: 'ExpectedRelatedMenuOnlyForAnsweredSupportOffer',
  },
  {
    args: {related: [{offer: support, related: []}]},
    description: 'The support offer has its own menu',
    error: 'ExpectedOneMenuForEachRelatedSupportOffer',
  },
  {
    args: {
      related: [{offer: episode, related: []}, {offer: episode, related: []}],
    },
    description: 'A support offer has one menu',
    error: 'ExpectedOneMenuForEachRelatedSupportOffer',
  },
  {
    args: {related: [{offer: episode, related: [{offer: testnet}]}]},
    description: 'Related offers are for the network of the support offer',
    error: 'ExpectedRelatedOffersForSupportOfferNetwork',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => make(args), new Error(error), 'Got error');
    }

    deepStrictEqual(make(args), expected, 'Got expected result');
  });
});
