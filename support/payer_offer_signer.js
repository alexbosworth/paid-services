const {isPoint} = require('tiny-secp256k1');
const {parseOffer} = require('invoices');

const hexAsBip353Name = require('./hex_as_bip353_name');
const {truncatedAsNumber} = require('./../service_records');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isIssuerKey = n => n.length === lengthKeyHex && isPoint(hexAsBuffer(n));
const lengthIdHex = 32;
const lengthKeyHex = 66;
const numberOf = ({value}) => truncatedAsNumber({encoded: value}).number;

/** Get the payer offer and the issuer id that signs it, from its records

  A whole offer that cannot be paid on the network, or that has expired, has
  no signer.

  {
    [issuer]: <Issuer Id Record Object>
    [name]: <BIP 353 Name Record Object>
    network: <Paid Support Offer Bitcoin Network Name String>
    [offer]: <Offer Record Object>
    [sequence]: <Service Sequence Record Object>
    [service]: <Service Id Record Object>
  }

  @throws
  <Error>

  @returns
  {
    [issuer_id]: <Payer Offer Issuer Id Public Key Hex String>
    [payer_offer]: <BOLT 12 Payer Offer String>
    [payer_offer_reference]: {
      bip353_name: <Payer Offer BIP 353 Human Readable Name String>
      issuer_id: <Payer Offer Issuer Id Public Key Hex String>
      network: <Paid Support Offer Bitcoin Network Name String>
      [service_id]: <Payer Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }
  }
*/
module.exports = args => {
  // Exit early when the payer offer is the whole offer
  if (!!args.offer) {
    const details = parseOffer({encoded: args.offer.value});

    // A payer offer that cannot be paid on the network is ignored
    if (!args.network || !details.networks.includes(args.network)) {
      return {};
    }

    // A payer offer that has expired is ignored
    if (details.is_expired) {
      return {};
    }

    return {issuer_id: details.issuer_id, payer_offer: details.offer};
  }

  if (!args.name || !args.issuer) {
    return {};
  }

  const issuerId = args.issuer.value;

  if (!isIssuerKey(issuerId)) {
    return {};
  }

  if (!!args.service && args.service.value.length !== lengthIdHex) {
    return {};
  }

  // A sequence is only for a reference to a support offer
  if (!!args.sequence && !args.service) {
    return {};
  }

  // A sequence is a minimal tu64
  const lowest = !args.sequence ? '0' : numberOf(args.sequence);

  const {bip353_name} = hexAsBip353Name({encoded: args.name.value});

  return {
    issuer_id: issuerId,
    payer_offer_reference: {
      bip353_name,
      issuer_id: issuerId,
      network: args.network,
      service_id: !args.service ? undefined : args.service.value,
      ...(lowest === '0' ? {} : {service_sequence: lowest}),
    },
  };
};
