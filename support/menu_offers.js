const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const isSupportOffer = require('./is_support_offer');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const offerSuggestedAmounts = require('./offer_suggested_amounts');
const offerWithPaths = require('./offer_with_paths');
const {readServiceLabel} = require('./../service_records');
const {typeOfferPaths} = require('./constants');

const isSupport = offer => isSupportOffer({offer}).is_support_offer;

/** Get the offers on a page of a support menu that a payer can show

  An offer listed without its paths is given with the paths of the support
  offer, and is left out when it does not have the issuer id of the support
  offer. A `reference` is given with the network of the support offer: look
  up the offer at its name only when the payer chooses it, and check it with
  `verifyOfferReference` before using it. Offers that cannot be paid on the
  network of the support offer, or that have expired, are left out. The
  `service` label of an offer is given when it has one.

  {
    menu: {
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
    }
    offer: <BOLT 12 Support Offer String>
  }

  @returns
  {
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
  }
*/
module.exports = ({menu, offer}) => {
  const support = parseOffer({offer});
  const {network} = offerBitcoinNetwork({offer});

  const pathsRecord = decodeTlvStream({encoded: support.encoded}).records
    .find(n => n.type === typeOfferPaths);

  // Encode a record as a TLV stream of its own
  const asStream = ({type, value}) => {
    return encodeTlvStream({records: [{type, value}]}).encoded;
  };

  const paths = !pathsRecord ? null : asStream(pathsRecord);

  // Get the offer of an entry, with the paths of the support offer when it
  // was listed without its paths
  const entryOffer = entry => {
    if (!!entry.offer) {
      return entry.offer;
    }

    if (!paths) {
      return null;
    }

    try {
      const {encoded} = offerWithPaths({paths, encoded: entry.without_paths});

      const withPaths = parseOffer({encoded});

      // An offer without its paths has to be an offer of the same issuer
      if (withPaths.issuer_id !== support.issuer_id) {
        return null;
      }

      return withPaths.offer;
    } catch (err) {
      return null;
    }
  };

  const offers = menu.entries
    .map(entry => {
      // A reference is looked up at its name when the payer chooses it
      if (!!entry.reference) {
        return {
          is_same_issuer: entry.reference.issuer_id === support.issuer_id,
          is_support_offer: false,
          issuer_id: entry.reference.issuer_id,
          reference: {...entry.reference, network},
          suggested_mtokens: [],
        };
      }

      const entryString = entryOffer(entry);

      if (!entryString || !network) {
        return null;
      }

      const details = parseOffer({offer: entryString});

      // Offers that cannot be paid on the network of the support offer, or
      // that have expired, are left out
      if (!details.networks.includes(network) || !!details.is_expired) {
        return null;
      }

      const label = readServiceLabel({offer: entryString});

      // The service of a labeled offer is its type, version, id, and sequence
      const service = ({id, sequence, type, version}) => ({
        type,
        version,
        ...(!id ? {} : {id}),
        ...(!sequence ? {} : {sequence}),
      });
      const suggested = offerSuggestedAmounts({offer: entryString});

      return {
        amount: details.amount,
        currency: details.currency,
        description: details.description,
        expires_at: details.expires_at,
        is_same_issuer: !!details.issuer_id && (
          details.issuer_id === support.issuer_id
        ),
        is_support_offer: isSupport(entryString),
        issuer: details.issuer,
        issuer_id: details.issuer_id,
        mtokens: details.mtokens,
        offer: entryString,
        service: !label.type ? undefined : service(label),
        suggested_amounts: suggested.amounts,
        suggested_currency: suggested.currency,
        suggested_mtokens: suggested.mtokens,
      };
    })
    .filter(n => !!n);

  return {offers};
};
