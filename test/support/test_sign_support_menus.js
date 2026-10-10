const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../service_records');
const decode = require('./../../support/decode_support_menu');
const menuIdForPages = require('./../../support/menu_id_for_pages');
const signSupportMenus = require('./../../support/sign_support_menus');
const verify = require('./../../support/verify_menu_signature');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const expiresAt = '2100-01-01T00:00:00.000Z';
const sha256 = n => createHash('sha256').update(n).digest();

// Make an offer of the issuer of secret 1, a support offer when it has an id
const makeOffer = ({description, id, introduction}) => {
  const blinded = blindedPathFromHops({hops: [introduction]});

  const {offer} = createOffer({
    description,
    issuer_id: asKey(1),
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
  introduction: asKey(9),
});

// Offers with paths are large enough that only a few fit on a page
const related = Array(6).fill(null).map((n, i) => ({
  offer: makeOffer({description: `offer ${i}`, introduction: asKey(9)}),
}));

const [first, second] = related;

// Sign the tagged hash of the message with the issuer key
const lnd = {
  signer: {
    signMessage: ({msg, tag}, cbk) => {
      const tagHash = sha256(tag);

      const hash = sha256(Buffer.concat([tagHash, tagHash, msg]));

      return cbk(null, {
        signature: Buffer.from(signSchnorr(hash, Buffer.alloc(32, 1))),
      });
    },
  },
};

// Sign the pages of the menu of the support offer and decode them
const signPages = async args => {
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
        introduction: asKey(8),
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
        introduction: asKey(9),
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
