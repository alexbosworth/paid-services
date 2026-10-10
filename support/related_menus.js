const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const isSupportOffer = require('./is_support_offer');
const menuPages = require('./menu_pages');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const offerWithPaths = require('./offer_with_paths');
const {readServiceLabel} = require('./../service_records');
const relatedMenuLevels = require('./related_menu_levels');
const {typeOfferPaths} = require('./constants');
const {withoutRecord} = require('./../service_records');

const {isArray} = Array;

/** Make the menus of a support offer and of its related support offers

  A related offer with the issuer id of the support offer, and without an
  amount, currency, or quantity, is listed without its paths and is
  `answered` on the paths of the support offer. When it is a support offer,
  it can have a menu of its own, given as its `related` offers, nested as
  deep as `relatedMenuLevels` allows. Each support offer has one menu.

  {
    expires_at: <Pages Expire At ISO 8601 Date String>
    issuer_id: <Support Offer Issuer Id Public Key Hex String>
    offer: <BOLT 12 Support Offer String>
    related: [{
      [bip353_name]: <Related Offer BIP 353 Human Readable Name String>
      [issuer_id]: <Related Offer Issuer Id Public Key Hex String>
      [offer]: <Related BOLT 12 Offer String>
      [related]: [<Related Offer of the Related Support Offer Object>]
      [service_id]: <Related Support Offer Service Id Hex String>
      [service_sequence]: <Related Support Offer Lowest Sequence String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    answered: [<BOLT 12 Offer Answered on the Support Offer Paths String>]
    menus: [{
      entries: [{
        [bip353_name]: <Offer BIP 353 Human Readable Name String>
        [is_without_paths]: <Offer Is Reached Over Support Offer Paths Bool>
        [issuer_id]: <Offer Issuer Id Public Key Hex String>
        [offer]: <BOLT 12 Offer String>
        [service_id]: <Support Offer Service Id Hex String>
        [service_sequence]: <Lowest Support Offer Service Sequence String>
      }]
      offer: <BOLT 12 Support Offer With the Support Offer Paths String>
    }]
  }
*/
module.exports = args => {
  // Menus are checked to not be nested too deep before any are made
  if (!relatedMenuLevels({related: args.related}).is_within_max_depth) {
    throw new Error('ExpectedFewerLevelsOfRelatedMenus');
  }

  const support = parseOffer({offer: args.offer});

  const {network} = offerBitcoinNetwork({offer: args.offer});

  const [paths] = decodeTlvStream({encoded: support.encoded}).records
    .filter(n => n.type === typeOfferPaths)
    .map(n => encodeTlvStream({records: [n]}).encoded);

  const answered = [];
  const menus = [];
  const serviceIds = new Set();

  // Make the menu of a support offer from its related offers
  const addMenu = (menuOffer, list) => {
    // A support offer has one menu
    const serviceId = readServiceLabel({offer: menuOffer}).id;

    if (serviceIds.has(serviceId)) {
      throw new Error('ExpectedOneMenuForEachRelatedSupportOffer');
    }

    serviceIds.add(serviceId);

    const menu = {offer: menuOffer};

    // Menus are added in the order they are reached
    menus.push(menu);

    menu.entries = list.map(entry => {
      // Exit early when the entry is a reference
      if (!entry.offer) {
        if (!!entry.related) {
          throw new Error('ExpectedRelatedMenuOnlyForAnsweredSupportOffer');
        }

        return {
          bip353_name: entry.bip353_name,
          issuer_id: entry.issuer_id,
          service_id: entry.service_id,
          service_sequence: entry.service_sequence,
        };
      }

      const details = parseOffer({offer: entry.offer});

      // Related offers can be paid on the network of the support offer
      if (!details.networks.includes(network)) {
        throw new Error('ExpectedRelatedOffersForSupportOfferNetwork');
      }

      // The supporter chooses the amount of an offer without paths
      const isAmountless = details.amount === undefined && (
        details.mtokens === undefined &&
        details.max_quantity === undefined
      );

      // Exit early when the offer is listed whole
      if (details.issuer_id !== args.issuer_id || !isAmountless) {
        if (!!entry.related) {
          throw new Error('ExpectedRelatedMenuOnlyForAnsweredSupportOffer');
        }

        return {offer: entry.offer};
      }

      const {encoded} = offerWithPaths({
        paths,
        encoded: withoutRecord({
          encoded: details.encoded,
          type: typeOfferPaths,
        })
        .encoded,
      });

      // The offer is reached over the paths of the support offer
      const reached = parseOffer({encoded}).offer;

      if (!answered.includes(reached)) {
        answered.push(reached);
      }

      // A related support offer can have a menu of its own
      if (!!entry.related) {
        if (!isArray(entry.related)) {
          throw new Error('ExpectedArrayOfRelatedOffersForRelatedMenu');
        }

        if (!isSupportOffer({offer: reached}).is_support_offer) {
          throw new Error('ExpectedRelatedMenuOnlyForAnsweredSupportOffer');
        }

        if (offerBitcoinNetwork({offer: reached}).network !== network) {
          throw new Error('ExpectedRelatedMenuForSupportOfferNetwork');
        }

        addMenu(reached, entry.related);
      }

      return {offer: entry.offer, is_without_paths: true};
    });

    // The entries are checked to fit on menu pages
    menuPages({expires_at: args.expires_at, entries: menu.entries});
  };

  addMenu(args.offer, args.related || []);

  return {answered, menus};
};
