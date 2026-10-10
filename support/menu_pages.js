const encodeSupportMenu = require('./encode_support_menu');
const {menuIdBytes} = require('./constants');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const largePage = 65534;
const menuId = bufferAsHex(Buffer.alloc(menuIdBytes));

/** Split the entries of a support menu into pages, in their order, with as
  many entries on each page as fit

  There is always at least one page. An entry that does not fit on a page by
  itself cannot be on the menu.

  {
    entries: [{
      [bip353_name]: <Offer BIP 353 Human Readable Name String>
      [is_without_paths]: <Offer Is Reached Over Support Offer Paths Bool>
      [issuer_id]: <Offer Issuer Id Public Key Hex String>
      [offer]: <BOLT 12 Offer String>
      [service_id]: <Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }]
    expires_at: <Pages Expire At ISO 8601 Date String>
  }

  @throws
  <Error>

  @returns
  {
    pages: [[{
      [bip353_name]: <Offer BIP 353 Human Readable Name String>
      [is_without_paths]: <Offer Is Reached Over Support Offer Paths Bool>
      [issuer_id]: <Offer Issuer Id Public Key Hex String>
      [offer]: <BOLT 12 Offer String>
      [service_id]: <Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }]]
  }
*/
module.exports = args => {
  // A page fits when it fits with a large page number and count of pages, and
  // a menu id
  const isFitting = pageEntries => {
    try {
      encodeSupportMenu({
        expires_at: args.expires_at,
        entries: pageEntries,
        menu_id: menuId,
        page: largePage,
        pages: largePage + 1,
      });

      return true;
    } catch (err) {
      if (err.message === 'ExpectedSmallerSupportMenuPageToEncode') {
        return false;
      }

      throw err;
    }
  };

  const pages = args.entries.reduce((sum, entry) => {
    const current = sum[sum.length - 1];

    // Keep adding entries to the page while they fit
    if (isFitting(current.concat(entry))) {
      return sum.slice(0, -1).concat([current.concat(entry)]);
    }

    if (!isFitting([entry])) {
      throw new Error('ExpectedRelatedOfferThatFitsOnAMenuPage');
    }

    return sum.concat([[entry]]);
  },
  [[]]);

  return {pages};
};
