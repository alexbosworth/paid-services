const {parseOffer} = require('invoices');

const isSupportOffer = require('./is_support_offer');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const {readServiceLabel} = require('./../service_records');

const isKey = n => typeof n === 'string' && /^0[23][0-9a-f]{64}$/i.test(n);

/** Check that an offer found at the BIP 353 name of a reference is the offer
  that the reference is for

  The offer has to be a valid offer that has not expired, with the issuer id
  of the reference, that can be paid on the network of the reference. When
  the reference has a service id, the offer has to be a support offer with
  that service id, with a service sequence that is not lower than the one
  of the reference. Check again each time the offer is used, since it can
  expire.

  Look up the name as BIP 353 describes, checking its DNSSEC proof, in a way
  that does not show the node's IP address, before checking the offer here.

  {
    offer: <BOLT 12 Offer Found at Reference Name String>
    reference: {
      issuer_id: <Offer Issuer Id Public Key Hex String>
      network: <Bitcoin Network Name String>
      [service_id]: <Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }
  }

  @returns
  {
    is_valid: <Offer Is the Offer of the Reference Bool>
  }
*/
module.exports = ({offer, reference}) => {
  try {
    const {is_expired, issuer_id, networks} = parseOffer({offer});

    // An offer that has expired is not used
    if (is_expired) {
      return {is_valid: false};
    }

    // A reference without an issuer id is not for any offer
    if (!reference || !isKey(reference.issuer_id) || !issuer_id) {
      return {is_valid: false};
    }

    // The offer has the issuer id of the reference, in any case
    if (issuer_id.toLowerCase() !== reference.issuer_id.toLowerCase()) {
      return {is_valid: false};
    }

    // The offer can be paid on the network of the reference
    if (!reference.network || !networks.includes(reference.network)) {
      return {is_valid: false};
    }

    // Exit early when the reference is not for a support offer
    if (!reference.service_id) {
      return {is_valid: true};
    }

    if (!isSupportOffer({offer}).is_support_offer) {
      return {is_valid: false};
    }

    const label = readServiceLabel({offer});

    // A support offer is known by its network, issuer id, and service id
    if (label.id !== reference.service_id) {
      return {is_valid: false};
    }

    const lowest = BigInt(reference.service_sequence || Number());

    // An older version of the support offer than the reference is not used
    if (BigInt(label.sequence || Number()) < lowest) {
      return {is_valid: false};
    }

    const {network} = offerBitcoinNetwork({offer});

    return {is_valid: network === reference.network};
  } catch (err) {
    return {is_valid: false};
  }
};
