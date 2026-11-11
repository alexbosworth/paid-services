const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {makeLnd} = require('mock-lnd');

const decode = require('./../../support/decode_support_menu');
const {derivedKeyFamily} = require('./../../support/constants');
const {first} = require('./fixtures/sign_support_menus');
const {makeOffer} = require('./fixtures/sign_support_menus');
const menuIdForPages = require('./../../support/menu_id_for_pages');
const {offer} = require('./fixtures/sign_support_menus');
const {related} = require('./fixtures/sign_support_menus');
const {second} = require('./fixtures/sign_support_menus');
const signSupportMenus = require('./../../support/sign_support_menus');
const verify = require('./../../support/verify_menu_signature');

const expiresAt = '2100-01-01T00:00:00.000Z';
const node = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967';
const otherNode = '03f991f944d1e1954a7fc8b9bf62e0d78f015f4c07762d505e20e6c45260a3661b';

// Sign the pages of the menu of the support offer and decode them
const signPages = async args => {
  // A fake LND that signs with the issuer key of secret 1 at key index 0
  const lnd = makeLnd({
    keys: [{family: derivedKeyFamily, index: 0, secret: '01'.repeat(32)}],
  });

  const {pages} = await signSupportMenus({
    lnd,
    offer,
    entries: related,
    expires_at: expiresAt,
    key_index: 0,
    ...args,
  });

  return pages.map(encoded => decode({encoded}));
};

// Sign the pages of a menu and describe them
const describePages = async args => {
  const pages = await signPages(args);

  const [{menu}] = pages;

  return {
    entries: pages.map(n => n.menu.entries).flat(),
    is_ordered: pages.every((n, i) => n.menu.page === i),
    is_signed: pages.every(n => verify({offer, ...n.signature}).is_valid),
    is_split: pages.length > 1,
    menu_id_bytes: menu.menu_id.length / 2,
    menu_ids: [...new Set(pages.map(n => n.menu.menu_id))].length,
  };
};

// Check the signature of the first page of the menu for an offer
const verifyFor = async ({other}) => {
  const [{signature}] = await signPages({});

  return verify({offer: other, ...signature});
};

// Find out if a menu has the menu id of the menu of the related offers
const isSameMenu = async args => {
  const [{menu}] = await signPages(args);
  const [original] = await signPages({});

  return {is_same: menu.menu_id === original.menu.menu_id};
};

// Find out if two sets of pages have the same menu id
const isSameId = ({a, b}) => {
  const id = pages => menuIdForPages({pages}).menu_id;

  return {is_same: id(a) === id(b)};
};

const tests = [
  {
    args: {},
    description: 'Offers are signed into ordered pages of one menu',
    expected: {
      entries: related,
      is_ordered: true,
      is_signed: true,
      is_split: true,
      menu_id_bytes: 16,
      menu_ids: 1,
    },
    method: describePages,
  },
  {
    args: {
      other: makeOffer({
        description: 'support changed',
        id: '0a'.repeat(16),
        introduction: otherNode,
      }),
    },
    description: 'A page is the menu of every version of the support offer',
    expected: {is_valid: true},
    method: verifyFor,
  },
  {
    args: {
      other: makeOffer({
        description: 'support',
        id: '0b'.repeat(16),
        introduction: node,
      }),
    },
    description: 'A page is not the menu of another support offer',
    expected: {is_valid: false},
    method: verifyFor,
  },
  {
    args: {expires_at: '2101-01-01T00:00:00.000Z'},
    description: 'A menu with a later expiry has the same menu id',
    expected: {is_same: true},
    method: isSameMenu,
  },
  {
    args: {entries: related.slice(1)},
    description: 'A menu of other offers has another menu id',
    expected: {is_same: false},
    method: isSameMenu,
  },
  {
    args: {entries: related.slice().reverse()},
    description: 'A menu of offers in another order has another menu id',
    expected: {is_same: false},
    method: isSameMenu,
  },
  {
    args: {pages: [[]]},
    description: 'A menu id is the hash of the entries on each page',
    expected: {menu_id: '6e340b9cffb37a989ca544e6bb780a2c'},
    method: menuIdForPages,
  },
  {
    args: {a: [[first, second]], b: [[first, second]]},
    description: 'The same pages have the same menu id',
    expected: {is_same: true},
    method: isSameId,
  },
  {
    args: {a: [[first, second]], b: [[first], [second]]},
    description: 'Entries on other pages have another menu id',
    expected: {is_same: false},
    method: isSameId,
  },
  {
    args: {a: [[first], [second]], b: [[second], [first]]},
    description: 'Pages in another order have another menu id',
    expected: {is_same: false},
    method: isSameId,
  },
  {
    args: {a: [[]], b: [[first]]},
    description: 'An empty menu has its own menu id',
    expected: {is_same: false},
    method: isSameId,
  },
  {
    args: {a: [[first]], b: [[{...first, is_without_paths: true}]]},
    description: 'An offer without its paths is another entry',
    expected: {is_same: false},
    method: isSameId,
  },
];

tests.forEach(({args, description, expected, method}) => {
  test(description, async () => {
    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
