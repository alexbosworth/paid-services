const {parseOffer} = require('invoices');

const offerBitcoinNetwork = require('./offer_bitcoin_network');
const {readServiceLabel} = require('./../service_records');
const {recordVersion} = require('./constants');
const {serviceTypes} = require('./../service_records');

/** Determine if an offer is a support offer: labeled with the support
  service type, a supported version, and a service id, for one Bitcoin
  network, with an issuer id and paths, and without an amount, currency, or
  maximum quantity

  {
    offer: <BOLT 12 Offer String>
  }

  @returns
  {
    is_support_offer: <Offer Is a Support Offer Bool>
  }
*/
module.exports = ({offer}) => {
  try {
    const details = parseOffer({offer});
    const {id, type, version} = readServiceLabel({offer});

    // The offer is labeled as a support offer of a supported version
    if (type !== serviceTypes.support) {
      return {is_support_offer: false};
    }

    if (version !== recordVersion) {
      return {is_support_offer: false};
    }

    // A support offer is known by its service id as its offer changes
    if (!id) {
      return {is_support_offer: false};
    }

    // The supporter chooses the amount, so there is nothing to multiply
    const isAmount = details.amount !== undefined || (
      details.mtokens !== undefined
    );

    if (isAmount || details.max_quantity !== undefined) {
      return {is_support_offer: false};
    }

    // The offer is for one Bitcoin network, which its menu offers are for
    if (!offerBitcoinNetwork({offer}).network) {
      return {is_support_offer: false};
    }

    // The issuer id and paths are how the offer and its menu are reached
    if (!details.issuer_id || !details.paths || !details.paths.length) {
      return {is_support_offer: false};
    }

    return {is_support_offer: true};
  } catch (err) {
    return {is_support_offer: false};
  }
};
