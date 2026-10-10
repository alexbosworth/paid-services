const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {createInvoiceError} = require('invoices');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');

const {derivedKeyFamily} = require('./constants');
const encodeSupportMenu = require('./encode_support_menu');
const menuIdForPages = require('./menu_id_for_pages');
const {menuMessage} = require('./constants');
const menuPages = require('./menu_pages');
const menuSignaturePreimage = require('./menu_signature_preimage');

const {isArray} = Array;
const {isSafeInteger} = Number;
const typeSchnorr = 'schnorr';

/** Sign the pages of a support menu with the offer issuer id key

  The entries are split into pages that expire at `expires_at`, with a menu
  id made from the entries. Each page is an invoice error TLV stream with the
  menu record, signed for the network, issuer id, and service id of the
  support offer.

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
    key_index: <Offer Issuer Id Key Index Number>
    lnd: <Authenticated LND API Object>
    offer: <BOLT 12 Support Offer String>
  }

  @returns via cbk or Promise
  {
    pages: [<Signed Menu Page Invoice Error TLV Stream Hex String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.expires_at) {
          return cbk([400, 'ExpectedExpiryToSignSupportMenu']);
        }

        if (!isSafeInteger(args.key_index)) {
          return cbk([400, 'ExpectedKeyIndexToSignSupportMenu']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSignSupportMenu']);
        }

        if (!args.offer) {
          return cbk([400, 'ExpectedSupportOfferToSignSupportMenu']);
        }

        if (!isArray(args.entries)) {
          return cbk([400, 'ExpectedMenuEntriesToSignSupportMenu']);
        }

        return cbk();
      },

      // Split the entries into pages to be signed
      unsigned: ['validate', ({}, cbk) => {
        try {
          const {pages} = menuPages({
            entries: args.entries,
            expires_at: args.expires_at,
          });

          const {menu_id} = menuIdForPages({pages});

          return cbk(null, pages.map((pageEntries, page) => ({
            menu_id,
            page,
            entries: pageEntries,
            pages: pages.length,
          })));
        } catch (err) {
          return cbk([400, 'FailedToMakeSupportMenuPages', {err}]);
        }
      }],

      // Sign each of the pages
      sign: ['unsigned', ({unsigned}, cbk) => {
        return asyncMapSeries(unsigned, (page, cbk) => {
          const {menu} = encodeSupportMenu({
            ...page,
            expires_at: args.expires_at,
          });

          const {preimage, tag} = menuSignaturePreimage({
            menu,
            offer: args.offer,
          });

          return signBytes({
            preimage,
            tag,
            key_family: derivedKeyFamily,
            key_index: args.key_index,
            lnd: args.lnd,
            type: typeSchnorr,
          },
          cbk);
        },
        cbk);
      }],

      // Put the signatures in the pages
      pages: ['sign', 'unsigned', ({sign, unsigned}, cbk) => {
        const {encoded} = createInvoiceError({message: menuMessage});

        const pages = unsigned.map((page, i) => {
          const menu = encodeSupportMenu({
            expires_at: args.expires_at,
            signature: sign[i].signature,
            ...page,
          });

          // The menu record comes after the error records
          return encoded + menu.encoded;
        });

        return cbk(null, {pages});
      }],
    },
    returnResult({reject, resolve, of: 'pages'}, cbk));
  });
};
