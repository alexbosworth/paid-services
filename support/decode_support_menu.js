const callOrThrow = require('./call_or_throw');
const decodeMenuEntry = require('./decode_menu_entry');
const {decodeRecords} = require('./../service_records');
const decodeSafeNumber = require('./decode_safe_number');
const hasUnknownEvenRecord = require('./has_unknown_even_record');
const {hexAsList} = require('./../service_records');
const {knownMenuTypes} = require('./known_record_types');
const {menuIdBytes} = require('./constants');
const {menuPageBytes} = require('./constants');
const {typeMenuEntries} = require('./constants');
const {typeMenuExpiry} = require('./constants');
const {typeMenuId} = require('./constants');
const {typeMenuPage} = require('./constants');
const {typeMenuPages} = require('./constants');
const {typeMenuSignature} = require('./constants');
const {typeSupportMenu} = require('./constants');
const {withoutRecord} = require('./../service_records');

const asNumber = n => decodeSafeNumber({error, encoded: n.value}).number;
const dateOf = seconds => new Date(seconds * msPerSecond);
const error = 'ExpectedSafeNumberInSupportMenu';
const findRecord = (records, type) => records.find(n => n.type === type);
const isValidDate = date => !isNaN(date.getTime());
const lengthSignatureHex = 128;
const msPerSecond = 1e3;

/** Decode a page of a support menu from an invoice error

  Entries that cannot be read, that have an unknown even record, or that are
  not exactly one of the whole offer, an offer without its paths, or a
  reference, are left out. A page over 768 bytes, with an unknown even
  record, without an expiry or a 16 byte menu id, or with a page number that
  is not below the count of pages is not read.

  The `signature` is returned with the page bytes it signs, as received, so
  that it can be checked against the support offer. A page without a
  signature is not to be used.

  {
    encoded: <Invoice Error TLV Stream Hex String>
  }

  @throws
  <Error>

  @returns
  {
    [menu]: {
      entries: [{
        [offer]: <BOLT 12 Offer String>
        [reference]: {
          bip353_name: <Offer BIP 353 Human Readable Name String>
          issuer_id: <Offer Issuer Id Public Key Hex String>
          [service_id]: <Support Offer Service Id Hex String>
          [service_sequence]: <Lowest Support Offer Service Sequence String>
        }
        [without_paths]: <Offer TLV Stream Without Paths Hex String>
      }]
      expires_at: <Page Expires At ISO 8601 Date String>
      menu_id: <Menu Id Hex String>
      page: <Page Number Number>
      pages: <Count of Pages Number>
    }
    [signature]: {
      menu: <Support Menu TLV Stream Without Signature Hex String>
      signature: <BIP 340 Page Signature Hex String>
    }
  }
*/
module.exports = ({encoded}) => {
  const errorRecords = callOrThrow({
    error: 'ExpectedTlvStreamInvoiceErrorToDecodeSupportMenu',
    method: () => decodeRecords({encoded}).records,
  });

  const menuRecord = findRecord(errorRecords, typeSupportMenu);

  // Exit early when there is no menu
  if (!menuRecord) {
    return {};
  }

  if (menuRecord.value.length / 2 > menuPageBytes) {
    throw new Error('ExpectedSmallerSupportMenuPageToDecode');
  }

  const menu = callOrThrow({
    error: 'ExpectedTlvStreamSupportMenu',
    method: () => decodeRecords({encoded: menuRecord.value}).records,
  });

  const unknown = hasUnknownEvenRecord({known: knownMenuTypes, records: menu});

  // Unknown even records cannot be ignored
  if (unknown.is_unknown_even) {
    throw new Error('UnexpectedUnknownRequiredRecordInSupportMenu');
  }

  const entriesRecord = findRecord(menu, typeMenuEntries);
  const expiryRecord = findRecord(menu, typeMenuExpiry);
  const idRecord = findRecord(menu, typeMenuId);
  const pageRecord = findRecord(menu, typeMenuPage);
  const pagesRecord = findRecord(menu, typeMenuPages);
  const signature = findRecord(menu, typeMenuSignature);

  if (!expiryRecord) {
    throw new Error('ExpectedExpiryInSupportMenu');
  }

  const expiry = dateOf(asNumber(expiryRecord));

  if (!isValidDate(expiry)) {
    throw new Error('ExpectedValidExpiryInSupportMenu');
  }

  // Pages are from the same menu when they have the same menu id
  if (!idRecord || idRecord.value.length / 2 !== menuIdBytes) {
    throw new Error('ExpectedMenuIdInSupportMenu');
  }

  // A page number is zero and a count of pages is one when left out
  const page = !pageRecord ? Number() : asNumber(pageRecord);
  const pages = !pagesRecord ? 1 : asNumber(pagesRecord);

  if (page >= pages) {
    throw new Error('ExpectedPageNumberBelowCountOfPagesInSupportMenu');
  }

  // Entries are a list
  const listOf = ({value}) => callOrThrow({
    error: 'ExpectedListOfEntriesInSupportMenu',
    method: () => hexAsList({encoded: value}).items,
  });

  const entries = !entriesRecord ? [] : listOf(entriesRecord);

  // Entries that cannot be used are left out
  const decodedEntries = entries
    .map(encoded => decodeMenuEntry({encoded}))
    .filter(n => !!n.offer || !!n.reference || !!n.without_paths);

  const decoded = {
    menu: {
      page,
      pages,
      entries: decodedEntries,
      expires_at: expiry.toISOString(),
      menu_id: idRecord.value,
    },
  };

  // Exit early when the page is not signed
  if (!signature || signature.value.length !== lengthSignatureHex) {
    return decoded;
  }

  // The signed bytes are the page as it was received, with only the
  // signature record cut out, including records that are not known
  const unsigned = withoutRecord({
    encoded: menuRecord.value,
    type: typeMenuSignature,
  });

  return {
    ...decoded,
    signature: {menu: unsigned.encoded, signature: signature.value},
  };
};
