const {encodeTlvStream} = require('bolt01');

const encodeMenuEntry = require('./encode_menu_entry');
const {listAsHex} = require('./../service_records');
const {menuIdBytes} = require('./constants');
const {menuPageBytes} = require('./constants');
const {numberAsTruncated} = require('./../service_records');
const {typeMenuEntries} = require('./constants');
const {typeMenuExpiry} = require('./constants');
const {typeMenuId} = require('./constants');
const {typeMenuPage} = require('./constants');
const {typeMenuPages} = require('./constants');
const {typeMenuSignature} = require('./constants');
const {typeSupportMenu} = require('./constants');

const asSeconds = date => floor(Date.parse(date) / msPerSecond);
const byteLength = hex => hex.length / 2;
const {floor} = Math;
const {isArray} = Array;
const {isSafeInteger} = Number;
const isDate = n => typeof n === 'string' && !isNaN(Date.parse(n));
const isMenuId = n => typeof n === 'string' && /^[0-9a-f]*$/i.test(n);
const isPageNumber = n => isSafeInteger(n) && n >= 0;
const isSignature = n => /^[0-9a-f]{128}$/i.test(n);
const lengthSignatureRecord = 66;
const msPerSecond = 1e3;
const truncated = number => numberAsTruncated({number: String(number)});

/** Encode a page of a support menu as a record to add to an invoice error

  A page is at most 768 bytes with its signature. Without a `signature`, the
  page is encoded to be signed, and is checked to have room for one.

  {
    entries: [{
      [bip353_name]: <Offer BIP 353 Human Readable Name String>
      [is_without_paths]: <Offer Is Reached Over Support Offer Paths Bool>
      [issuer_id]: <Offer Issuer Id Public Key Hex String>
      [offer]: <BOLT 12 Offer String>
      [service_id]: <Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }]
    expires_at: <Page Expires At ISO 8601 Date String>
    menu_id: <Menu Id Hex String>
    page: <Page Number Number>
    pages: <Count of Pages Number>
    [signature]: <BIP 340 Page Signature Hex String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Support Menu Record TLV Stream Hex String>
    menu: <Support Menu TLV Stream Hex String>
  }
*/
module.exports = args => {
  if (!isDate(args.expires_at)) {
    throw new Error('ExpectedExpiryDateToEncodeSupportMenu');
  }

  if (!isMenuId(args.menu_id) || byteLength(args.menu_id) !== menuIdBytes) {
    throw new Error('ExpectedMenuIdToEncodeSupportMenu');
  }

  if (!isArray(args.entries)) {
    throw new Error('ExpectedArrayOfEntriesToEncodeSupportMenu');
  }

  if (!isPageNumber(args.page) || !isPageNumber(args.pages)) {
    throw new Error('ExpectedPageOfPagesToEncodeSupportMenu');
  }

  if (args.page >= args.pages) {
    throw new Error('ExpectedPageOfPagesToEncodeSupportMenu');
  }

  if (args.signature !== undefined && !isSignature(args.signature)) {
    throw new Error('ExpectedSchnorrSignatureToEncodeSupportMenu');
  }

  const items = args.entries.map(entry => {
    try {
      return encodeMenuEntry(entry || {}).encoded;
    } catch (err) {
      throw new Error('ExpectedValidEntryInSupportMenu');
    }
  });

  const expiry = asSeconds(args.expires_at);

  const entriesRecord = {
    type: typeMenuEntries,
    value: listAsHex({items}).encoded,
  };

  const pageRecord = {type: typeMenuPage, value: truncated(args.page).encoded};
  const pagesRecord = {
    type: typeMenuPages,
    value: truncated(args.pages).encoded,
  };
  const signatureRecord = {type: typeMenuSignature, value: args.signature};

  // Entries, the page, and the count of pages are left out when they have
  // their default values
  const menu = encodeTlvStream({
    records: [
      !items.length ? null : entriesRecord,
      !args.page ? null : pageRecord,
      args.pages === 1 ? null : pagesRecord,
      {type: typeMenuExpiry, value: truncated(expiry).encoded},
      {type: typeMenuId, value: args.menu_id.toLowerCase()},
      !args.signature ? null : signatureRecord,
    ]
    .filter(n => !!n),
  });

  const room = !args.signature ? lengthSignatureRecord : Number();

  // A page has to fit in an onion message of the regular size
  if (byteLength(menu.encoded) + room > menuPageBytes) {
    throw new Error('ExpectedSmallerSupportMenuPageToEncode');
  }

  const record = encodeTlvStream({
    records: [{type: typeSupportMenu, value: menu.encoded}],
  });

  return {encoded: record.encoded, menu: menu.encoded};
};
