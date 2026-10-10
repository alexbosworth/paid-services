const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createInvoiceError} = require('invoices');
const {createOffer} = require('invoices');
const {encodeTlvStream} = require('bolt01');
const {parseInvoiceError} = require('invoices');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const decode = require('./../../support/decode_support_menu');
const encode = require('./../../support/encode_support_menu');
const {addServiceLabel} = require('./../../service_records');
const decodeEntry = require('./../../support/decode_menu_entry');
const encodeEntry = require('./../../support/encode_menu_entry');
const {listAsHex} = require('./../../service_records');
const {withoutRecord} = require('./../../service_records');
const menuPages = require('./../../support/menu_pages');
const preimage = require('./../../support/menu_signature_preimage');
const verify = require('./../../support/verify_menu_signature');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const expiresAt = '2100-01-01T00:00:00.000Z';
const nameHex = '0567756573740b6578616d706c652e636f6d';
const node = asKey(9);

const blinded = blindedPathFromHops({hops: [node]});
const {key} = blinded;
const paths = [{key, hops: blinded.path, introduction_node: node}];

// The support offer that pages are signed for, made by the key of secret 1
const art = addServiceLabel({
  id: '0a'.repeat(16),
  offer: createOffer({
    description: 'art',
    issuer_id: asKey(1),
    networks: ['regtest'],
  })
  .offer,
  type: '1',
  version: 1,
})
.offer;

const music = createOffer({
  description: 'music',
  issuer_id: asKey(2),
  networks: ['regtest'],
}).offer;

// An offer with paths, and offers with paths that only a few fit on a page
const withPaths = createOffer({
  paths,
  description: 'paths',
  issuer_id: asKey(1),
})
.offer;

const offers = Array(7).fill(null).map((n, i) => createOffer({
  paths,
  description: `offer ${i}`,
  issuer_id: asKey(1),
}).offer);

const reference = {
  bip353_name: 'guest@example.com',
  issuer_id: asKey(2),
  service_id: '0d'.repeat(16),
};

const {encoded: invoiceError} = createInvoiceError({message: 'SupportMenu'});

// The expiry record of the start of 2100, and the menu id of these pages
const expiry = {type: '6', value: 'f4865700'};
const menuId = '0a'.repeat(16);
const idRecord = {type: '8', value: menuId};

// The arguments to encode a first page of one page with
const page = {expires_at: expiresAt, menu_id: menuId, page: 0, pages: 1};

// A decoded first page of one page with entries
const menuOf = entries => ({menu: {...page, entries}});

// Make an invoice error with a menu of records
const withMenu = records => invoiceError + encodeTlvStream({
  records: [{type: '805805', value: encodeTlvStream({records}).encoded}],
}).encoded;

// Make an invoice error with a menu of records in the order they are given
const withRecords = records => invoiceError + encodeTlvStream({
  records: [{
    type: '805805',
    value: records.map(n => encodeTlvStream({records: [n]}).encoded).join(''),
  }],
})
.encoded;

// Make a menu of records that is a number of bytes long, with padding
const menuOfLength = (records, bytes) => {
  const padding = length => ({type: '7', value: '00'.repeat(length)});

  const length = Array(bytes).fill(null).map((n, i) => i).find(i => {
    const {encoded} = encodeTlvStream({records: records.concat(padding(i))});

    return encoded.length / 2 === bytes;
  });

  return records.concat(padding(length));
};

// Sign a menu for the art offer, with the key of secret 1
const signMenu = menu => {
  const {hash} = preimage({menu, offer: art});

  const signature = signSchnorr(Buffer.from(hash, 'hex'), Buffer.alloc(32, 1));

  return {menu, signature: Buffer.from(signature).toString('hex')};
};

// Sign a menu of records
const signRecords = records => signMenu(encodeTlvStream({records}).encoded);

// A page of the music offer, signed
const unsigned = encode({...page, entries: [{offer: music}]});
const {signature} = signMenu(unsigned.menu);
const signed = encode({...page, signature, entries: [{offer: music}]});

// A page with unknown odd records before and after its signature, signed
const oddRecords = [
  expiry,
  {type: '7', value: '00'},
  idRecord,
  {type: '241', value: '01'},
];
const oddSigned = signRecords(oddRecords);

// Make an entry of records
const entryOf = records => ({encoded: encodeTlvStream({records}).encoded});

// Encode an entry and decode it again
const entryRoundTrip = args => decodeEntry(encodeEntry(args));

// Encode a page and decode it again
const pageRoundTrip = args => {
  return decode({encoded: invoiceError + encode(args).encoded});
};

// Split entries into pages, checking every page can be encoded
const splitPages = ({entries}) => {
  const {pages} = menuPages({entries, expires_at: expiresAt});

  pages.forEach((pageEntries, n) => encode({
    ...page,
    entries: pageEntries,
    page: n,
    pages: pages.length,
  }));

  return {entries: pages.flat(), is_split: pages.length > 1};
};

const tests = [
  {
    args: {...page, entries: [{offer: art}, {offer: music}]},
    description: 'A page is decoded to what it was encoded with',
    expected: menuOf([{offer: art}, {offer: music}]),
    method: pageRoundTrip,
  },
  {
    args: {...page, entries: [{offer: art}], page: 2, pages: 3},
    description: 'A page says which page it is of how many',
    expected: {menu: {...page, entries: [{offer: art}], page: 2, pages: 3}},
    method: pageRoundTrip,
  },
  {
    args: {...page, entries: [], page: 1},
    description: 'A page is not made with a number that is not below pages',
    error: 'ExpectedPageOfPagesToEncodeSupportMenu',
    method: encode,
  },
  {
    args: {encoded: withMenu([expiry, idRecord, {type: '2', value: '01'}])},
    description: 'A page with a number that is not below pages is not read',
    error: 'ExpectedPageNumberBelowCountOfPagesInSupportMenu',
    method: decode,
  },
  {
    args: {encoded: invoiceError + unsigned.encoded},
    description: 'An invoice error with a menu is still an invoice error',
    expected: {
      erroneous_field: undefined,
      message: 'SupportMenu',
      suggested_value: undefined,
    },
    method: parseInvoiceError,
  },
  {
    args: {...page, entries: []},
    description: 'An empty menu is a menu',
    expected: menuOf([]),
    method: pageRoundTrip,
  },
  {
    args: {encoded: invoiceError},
    description: 'An invoice error without a menu has no menu',
    expected: {},
    method: decode,
  },
  {
    args: {encoded: withMenu([idRecord])},
    description: 'A page needs an expiry',
    error: 'ExpectedExpiryInSupportMenu',
    method: decode,
  },
  {
    args: {encoded: withMenu([expiry])},
    description: 'A page needs a menu id',
    error: 'ExpectedMenuIdInSupportMenu',
    method: decode,
  },
  {
    args: {encoded: withMenu([expiry, {type: '8', value: '0a'.repeat(15)}])},
    description: 'A menu id is 16 bytes',
    error: 'ExpectedMenuIdInSupportMenu',
    method: decode,
  },
  {
    args: {entries: [], expires_at: expiresAt, page: 0, pages: 1},
    description: 'A page is made with a menu id',
    error: 'ExpectedMenuIdToEncodeSupportMenu',
    method: encode,
  },
  {
    args: {encoded: withRecords([expiry, idRecord])},
    description: 'A page with records in order is read',
    expected: menuOf([]),
    method: decode,
  },
  {
    args: {encoded: withRecords([idRecord, expiry])},
    description: 'A page with records out of order is not read',
    error: 'ExpectedTlvStreamSupportMenu',
    method: decode,
  },
  {
    args: {encoded: withRecords([expiry, idRecord, idRecord])},
    description: 'A page with a repeated record is not read',
    error: 'ExpectedTlvStreamSupportMenu',
    method: decode,
  },
  {
    args: {
      encoded: withMenu([
        {
          type: '0',
          value: listAsHex({
            items: [
              // An entry with an unknown even record
              entryOf([
                {type: '0', value: parseOffer({offer: art}).encoded},
                {type: '12', value: '00'},
              ])
              .encoded,
              // An entry with an unknown odd record
              entryOf([
                {type: '0', value: parseOffer({offer: art}).encoded},
                {type: '3', value: '00'},
              ])
              .encoded,
              // An entry that is not a valid offer
              entryOf([{type: '0', value: '00'}]).encoded,
              // An entry without an offer
              entryOf([{type: '1', value: '00'}]).encoded,
            ],
          })
          .encoded,
        },
        expiry,
        idRecord,
      ]),
    },
    description: 'Entries that cannot be used are left out of the menu',
    expected: menuOf([{offer: art}]),
    method: decode,
  },
  {
    args: {encoded: withMenu([expiry, idRecord, {type: '10', value: '00'}])},
    description: 'A page with an unknown even record is not read',
    error: 'UnexpectedUnknownRequiredRecordInSupportMenu',
    method: decode,
  },
  {
    args: {
      encoded: withMenu([
        {type: '0', value: listAsHex({items: []}).encoded},
        expiry,
        {type: '7', value: '00'},
        idRecord,
      ]),
    },
    description: 'Unknown odd records in a page are ignored',
    expected: menuOf([]),
    method: decode,
  },
  {
    args: {...page, entries: Array(20).fill({offer: art})},
    description: 'A page that is too long is not made',
    error: 'ExpectedSmallerSupportMenuPageToEncode',
    method: encode,
  },
  {
    args: {encoded: withMenu(menuOfLength([expiry, idRecord], 768))},
    description: 'A page of 768 bytes is read',
    expected: menuOf([]),
    method: decode,
  },
  {
    args: {encoded: withMenu(menuOfLength([expiry, idRecord], 769))},
    description: 'A page of 769 bytes is not read',
    error: 'ExpectedSmallerSupportMenuPageToDecode',
    method: decode,
  },
  {
    args: {entries: offers.map(offer => ({offer}))},
    description: 'Offers are split in order into pages that fit',
    expected: {entries: offers.map(offer => ({offer})), is_split: true},
    method: splitPages,
  },
  {
    args: {entries: offers.map(offer => ({offer, is_without_paths: true}))},
    description: 'Offers without their paths fit on one page',
    expected: {
      pages: [offers.map(offer => ({offer, is_without_paths: true}))],
    },
    method: args => menuPages({...args, expires_at: expiresAt}),
  },
  {
    args: {entries: [], expires_at: expiresAt},
    description: 'A menu without offers has one page',
    expected: {pages: [[]]},
    method: menuPages,
  },
  {
    args: {encoded: invoiceError + signed.encoded},
    description: 'A signed page has the signature and the page it signs',
    expected: {
      ...menuOf([{offer: music}]),
      signature: {signature, menu: unsigned.menu},
    },
    method: decode,
  },
  {
    args: {signature, menu: unsigned.menu, offer: art},
    description: 'A page is signed by the support offer issuer id',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {signature, menu: unsigned.menu, offer: music},
    description: 'A page is signed for one support offer',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {signature, menu: unsigned.menu + '0700', offer: art},
    description: 'A signature does not cover a changed page',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {encoded: withMenu([expiry, idRecord, {type: '240', value: '00'}])},
    description: 'A signature that is not 64 bytes is not a signature',
    expected: menuOf([]),
    method: decode,
  },
  {
    args: {
      encoded: withMenu(oddRecords.concat({
        type: '240',
        value: oddSigned.signature,
      })),
    },
    description: 'The signed bytes are the page as it was received',
    expected: {...menuOf([]), signature: oddSigned},
    method: decode,
  },
  {
    args: {...oddSigned, offer: art},
    description: 'The signature covers unknown records',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {
      menu: signRecords([expiry, idRecord]).menu,
      offer: art,
      signature: oddSigned.signature,
    },
    description: 'The signature does not cover the page without its records',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      encoded: withMenu([idRecord].concat({
        type: '240',
        value: signRecords([idRecord]).signature,
      })),
    },
    description: 'A signed page still needs an expiry',
    error: 'ExpectedExpiryInSupportMenu',
    method: decode,
  },
  {
    args: {
      encoded: withMenu([expiry].concat({
        type: '240',
        value: signRecords([expiry]).signature,
      })),
    },
    description: 'A signed page still needs a menu id',
    error: 'ExpectedMenuIdInSupportMenu',
    method: decode,
  },
  {
    args: {offer: withPaths, is_without_paths: true},
    description: 'An offer without paths is the offer without its paths',
    expected: {
      without_paths: withoutRecord({
        encoded: parseOffer({offer: withPaths}).encoded,
        type: '16',
      })
      .encoded,
    },
    method: entryRoundTrip,
  },
  {
    args: reference,
    description: 'A reference entry is read',
    expected: {reference},
    method: entryRoundTrip,
  },
  {
    args: {offer: music},
    description: 'A whole offer entry is read',
    expected: {offer: music},
    method: entryRoundTrip,
  },
  {
    args: {...reference, service_sequence: '3'},
    description: 'A reference can have the lowest sequence of its offer',
    expected: {reference: {...reference, service_sequence: '3'}},
    method: entryRoundTrip,
  },
  {
    args: {...reference, service_sequence: '0'},
    description: 'A sequence of zero is left out',
    expected: {reference},
    method: entryRoundTrip,
  },
  {
    args: {offer: music, ...reference},
    description: 'An entry is either an offer or a reference',
    error: 'ExpectedEitherOfferOrReferenceToEncodeMenuEntry',
    method: encodeEntry,
  },
  {
    args: {bip353_name: 'guest@example.com', issuer_id: '00'},
    description: 'A reference has an issuer id',
    error: 'ExpectedIssuerIdToEncodeMenuEntryReference',
    method: encodeEntry,
  },
  {
    args: {
      bip353_name: reference.bip353_name,
      issuer_id: reference.issuer_id,
      service_sequence: '3',
    },
    description: 'A sequence is for a reference with a service id',
    error: 'ExpectedServiceIdForServiceSequenceOfMenuEntry',
    method: encodeEntry,
  },
  {
    args: {...reference, service_sequence: 'x'},
    description: 'A sequence is a number',
    error: 'ExpectedServiceSequenceToEncodeMenuEntryReference',
    method: encodeEntry,
  },
  {
    args: entryOf([
      {type: '0', value: parseOffer({offer: music}).encoded},
      {type: '8', value: parseOffer({offer: music}).encoded},
    ]),
    description: 'An entry with an offer and an offer without paths is left',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '0', value: parseOffer({offer: music}).encoded},
      {type: '2', value: nameHex},
    ]),
    description: 'An entry with an offer and a name is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '0', value: parseOffer({offer: music}).encoded},
      {type: '6', value: '0d'.repeat(16)},
    ]),
    description: 'An entry with an offer and a service id is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([{type: '2', value: nameHex}]),
    description: 'An entry with a name and no issuer id is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '2', value: nameHex},
      {type: '4', value: '02' + '00'.repeat(32)},
    ]),
    description: 'An entry with an issuer id that is not a point is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '2', value: nameHex},
      {type: '4', value: reference.issuer_id},
      {type: '6', value: '0d'.repeat(15)},
    ]),
    description: 'An entry with a service id of 15 bytes is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([{
      type: '8',
      value: parseOffer({offer: withPaths}).encoded,
    }]),
    description: 'An entry of an offer without paths with paths is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '2', value: nameHex},
      {type: '4', value: reference.issuer_id},
      {type: '10', value: '03'},
    ]),
    description: 'An entry with a sequence and no service id is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '2', value: nameHex},
      {type: '4', value: reference.issuer_id},
      {type: '6', value: reference.service_id},
      {type: '10', value: '0003'},
    ]),
    description: 'An entry with a sequence that is not minimal is left out',
    expected: {},
    method: decodeEntry,
  },
  {
    args: entryOf([
      {type: '0', value: parseOffer({offer: music}).encoded},
      {type: '10', value: '03'},
    ]),
    description: 'An entry with a whole offer and a sequence is left out',
    expected: {},
    method: decodeEntry,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
