const asyncAuto = require('async/auto');
const {getNetwork} = require('ln-sync');
const {getPeers} = require('ln-service');
const {parseInvoiceError} = require('invoices');
const {parseOffer} = require('invoices');
const {returnResult} = require('asyncjs-util');

const createMenuRequest = require('./create_menu_request');
const decodeSupportMenu = require('./decode_support_menu');
const {defaultMenuTimeoutMs} = require('./constants');
const isReplyTooLarge = require('./is_reply_too_large');
const isSupportOffer = require('./is_support_offer');
const menuOffers = require('./menu_offers');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const offerSuggestedAmounts = require('./offer_suggested_amounts');
const replyIntroduction = require('./../network/reply_introduction');
const {requestNetworkReply} = require('./../network');
const {resolvePathIntroductions} = require('./../network');
const {typeInvoice} = require('./constants');
const {typeInvoiceError} = require('./constants');
const {typeInvoiceRequest} = require('./constants');
const {typeMenuRequest} = require('./constants');
const verifyMenuSignature = require('./verify_menu_signature');

const {isSafeInteger} = Number;
const isExpired = date => Date.parse(date) <= Date.now();
const isMenuId = n => typeof n === 'string' && /^[0-9a-f]{32}$/i.test(n);
const isPage = n => n === undefined || (isSafeInteger(n) && n >= 0);
const isTimeout = n => n === undefined || (isSafeInteger(n) && n > 0);

/** Get a page of the menu of a support offer

  The menu lists related offers that a supporter can choose to pay, split
  into pages. The first page is page zero, and each page says how many pages
  there are. The request is a signed invoice request with the menu request
  record, sent over the first path of the offer with a payer id that is only
  used once, and the reply path starts at a connected peer that relays onion
  messages when there is one. A reply without a page means the menu is not
  supported, and an invoice sent back is not paid.

  A page is only used when it is signed by the support offer issuer id, has
  not expired, is the page asked for, and has the `menu_id` given when there
  is one, since pages with another id are from another menu. A request that
  is not answered with a page fails with `SupportMenuRequestNotAnswered`,
  with `is_reply_too_large` when the page did not fit in an onion message of
  the regular size.

  An entry is the whole offer, an offer of the recipient given with the paths
  of the support offer, or a `reference` to an offer at a BIP 353 name. Look
  up a reference only when the supporter chooses it, in a way that does not
  show the node's IP address, and check what is found with
  `verifyOfferReference` before showing or paying it. Only an offer with
  `is_same_issuer` pays the same recipient as the support offer. The text of
  an offer is not signed by the page, and the page does not sign the support
  offer itself.

  Suggested amounts are `suggested_mtokens`, or `suggested_amounts` in the
  minor units of an ISO 4217 `suggested_currency` to convert at an exchange
  rate, leaving out an amount under one millitoken. Offers that cannot be
  paid on the network of the support offer, or that have expired, are left
  out.

  Give the `bip353_name` when the offer was found with a human readable name,
  since BOLT 12 requires it in the request.

  {
    [bip353_name]: <BIP 353 Human Readable Name String>
    lnd: <Authenticated LND API Object>
    [menu_id]: <Menu Id of Pages Already Shown Hex String>
    offer: <BOLT 12 Support Offer String>
    [page]: <Menu Page Number Number>
    [timeout]: <Reply Timeout Milliseconds Number>
  }

  @returns via cbk or Promise
  {
    expires_at: <Page Expires At ISO 8601 Date String>
    menu_id: <Menu Id Hex String>
    offers: [{
      [amount]: <Offer Amount in Currency Minor Units String>
      [currency]: <Offer Amount ISO 4217 Currency Code String>
      [description]: <Offer Description String>
      [expires_at]: <Offer Expires At ISO 8601 Date String>
      is_same_issuer: <Offer Has Issuer Id of Support Offer Bool>
      is_support_offer: <Offer Is a Support Offer Bool>
      [issuer]: <Offer Issuer Name String>
      [issuer_id]: <Offer Issuer Id Public Key Hex String>
      [mtokens]: <Offer Amount Millitokens String>
      [offer]: <BOLT 12 Offer String>
      [reference]: {
        bip353_name: <Offer BIP 353 Human Readable Name String>
        issuer_id: <Offer Issuer Id Public Key Hex String>
        network: <Support Offer Bitcoin Network Name String>
        [service_id]: <Support Offer Service Id Hex String>
        [service_sequence]: <Lowest Support Offer Service Sequence String>
      }
      [service]: {
        [id]: <Service Id Hex String>
        [sequence]: <Service Sequence Number String>
        type: <Service Type Number String>
        version: <Service Version Number>
      }
      [suggested_amounts]: [<Suggested Amount in Currency Minor Units String>]
      [suggested_currency]: <Suggested Amounts ISO 4217 Currency Code String>
      suggested_mtokens: [<Suggested Amount Millitokens String>]
    }]
    page: <Page Number Number>
    pages: <Count of Pages Number>
    [suggested_amounts]: [<Support Offer Suggested Currency Amount String>]
    [suggested_currency]: <Support Offer Suggested ISO 4217 Currency String>
    suggested_mtokens: [<Support Offer Suggested Millitokens String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetSupportMenu']);
        }

        if (!args.offer || typeof args.offer !== 'string') {
          return cbk([400, 'ExpectedSupportOfferToGetSupportMenu']);
        }

        if (args.menu_id !== undefined && !isMenuId(args.menu_id)) {
          return cbk([400, 'ExpectedMenuIdHexToGetSupportMenu']);
        }

        if (!isPage(args.page)) {
          return cbk([400, 'ExpectedPageNumberToGetSupportMenu']);
        }

        if (!isTimeout(args.timeout)) {
          return cbk([400, 'ExpectedPositiveTimeoutToGetSupportMenu']);
        }

        return cbk();
      },

      // Read the offer
      parse: ['validate', ({}, cbk) => {
        try {
          return cbk(null, parseOffer({offer: args.offer}));
        } catch (err) {
          return cbk([400, 'ExpectedValidOfferToGetSupportMenu']);
        }
      }],

      // Check the offer is a support offer
      details: ['parse', ({parse}, cbk) => {
        if (!isSupportOffer({offer: args.offer}).is_support_offer) {
          return cbk([400, 'ExpectedSupportOfferToGetSupportMenu']);
        }

        return cbk(null, parse);
      }],

      // Get the network of the node to check offers are for it
      getNetwork: ['details', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the connected peers to start the reply path at one of them
      getPeers: ['details', ({}, cbk) => getPeers({lnd: args.lnd}, cbk)],

      // Check the offer is for the network of the node
      checkNetwork: ['details', 'getNetwork', ({getNetwork}, cbk) => {
        const {network} = offerBitcoinNetwork({offer: args.offer});

        if (network !== getNetwork.bitcoinjs) {
          return cbk([400, 'ExpectedOfferForNodeNetworkToGetSupportMenu']);
        }

        return cbk();
      }],

      // Find the introduction node of the first path, to not reply from it
      getPath: ['details', ({details}, cbk) => {
        const [path] = details.paths;

        return resolvePathIntroductions({
          lnd: args.lnd,
          paths: [path],
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          // Exit early when the path has no known introduction node
          if (!res.paths.length) {
            return cbk([503, 'FailedToFindIntroductionNodeOfSupportOfferPath']);
          }

          return cbk(null, res.paths[Number()]);
        });
      }],

      // Select a peer that relays onion messages to start the reply path
      introduction: ['getPath', 'getPeers', ({getPath, getPeers}, cbk) => {
        const {peers} = getPeers;

        const {introduction} = replyIntroduction({path: getPath, peers});

        return cbk(null, introduction);
      }],

      // Make a signed invoice request that asks for the page
      message: ['checkNetwork', ({}, cbk) => {
        try {
          const {encoded} = createMenuRequest({
            bip353_name: args.bip353_name,
            offer: args.offer,
            page: args.page,
          });

          return cbk(null, {type: typeInvoiceRequest, value: encoded});
        } catch (err) {
          return cbk([400, 'FailedToCreateMenuRequest', {err}]);
        }
      }],

      // Send the request and wait for the reply
      getReply: [
        'getPath',
        'introduction',
        'message',
        ({getPath, introduction, message}, cbk) =>
      {
        return requestNetworkReply({
          introduction,
          message,
          lnd: args.lnd,
          path: getPath,
          timeout: args.timeout || defaultMenuTimeoutMs,
          types: [typeInvoice, typeInvoiceError],
        },
        cbk);
      }],

      // Read the invoice error from the reply
      invoiceError: ['getReply', ({getReply}, cbk) => {
        const {reply} = getReply;

        // An invoice is not paid, it is from a node without menu support
        if (reply.type !== typeInvoiceError) {
          return cbk([503, 'ExpectedInvoiceErrorWithSupportMenu']);
        }

        try {
          return cbk(null, parseInvoiceError({encoded: reply.value}));
        } catch (err) {
          return cbk([503, 'ExpectedValidInvoiceErrorWithSupportMenu']);
        }
      }],

      // Decode the page in the invoice error
      decode: ['getReply', 'invoiceError', ({getReply}, cbk) => {
        const {reply} = getReply;

        // A page that cannot be read is no menu, from a node with menu support
        try {
          return cbk(null, decodeSupportMenu({encoded: reply.value}));
        } catch (error) {
          return cbk([503, 'ExpectedValidSupportMenuPage', {error}]);
        }
      }],

      // Read the page from the reply
      read: [
        'decode',
        'getReply',
        'invoiceError',
        ({decode, getReply, invoiceError}, cbk) =>
      {
        const {menu, signature} = decode;
        const {reply} = getReply;

        // An error about the menu request is a request that was not answered
        if (!menu && invoiceError.erroneous_field === typeMenuRequest) {
          const tooLarge = isReplyTooLarge({encoded: reply.value});

          return cbk([503, 'SupportMenuRequestNotAnswered', {
            is_reply_too_large: tooLarge.is_reply_too_large,
            message: invoiceError.message,
          }]);
        }

        // A reply without a menu is from a node without menu support
        if (!menu) {
          return cbk([503, 'ExpectedSupportMenuInInvoiceError']);
        }

        return cbk(null, {menu, signature});
      }],

      // Check the page is signed, has not expired, and is the page asked for
      check: ['read', ({read}, cbk) => {
        const {menu, signature} = read;

        if (!signature) {
          return cbk([503, 'ExpectedSignedSupportMenuPage']);
        }

        const isValid = verifyMenuSignature({
          offer: args.offer,
          menu: signature.menu,
          signature: signature.signature,
        });

        if (!isValid.is_valid) {
          return cbk([503, 'ExpectedValidSignatureForSupportMenuPage']);
        }

        if (isExpired(menu.expires_at)) {
          return cbk([503, 'ExpectedUnexpiredSupportMenuPage']);
        }

        if (menu.page !== (args.page || Number())) {
          return cbk([503, 'ExpectedRequestedSupportMenuPage']);
        }

        // A page with another menu id is from another menu
        if (!!args.menu_id && menu.menu_id !== args.menu_id.toLowerCase()) {
          return cbk([503, 'SupportMenuChanged', {menu_id: menu.menu_id}]);
        }

        return cbk();
      }],

      // Show the offers on the page that can be paid
      menu: ['check', 'read', ({read}, cbk) => {
        const {menu} = read;

        try {
          const {offers} = menuOffers({menu, offer: args.offer});

          const suggested = offerSuggestedAmounts({offer: args.offer});

          return cbk(null, {
            offers,
            expires_at: menu.expires_at,
            menu_id: menu.menu_id,
            page: menu.page,
            pages: menu.pages,
            suggested_amounts: suggested.amounts,
            suggested_currency: suggested.currency,
            suggested_mtokens: suggested.mtokens,
          });
        } catch (err) {
          return cbk([503, 'FailedToReadSupportMenuOffers', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'menu'}, cbk));
  });
};
