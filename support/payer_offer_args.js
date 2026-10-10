const {readServiceLabel} = require('./../service_records');

/** Get the arguments to encode the whole payer offer or a reference to it

  A reference is used when there is a BIP 353 name to find the offer at.

  {
    [bip353_name]: <Offer BIP 353 Human Readable Name String>
    [expires_at]: <Payer Offer Expires At ISO 8601 Date String>
    issuer_id: <Offer Issuer Id Public Key Hex String>
    offer: <BOLT 12 Payer Support Offer String>
  }

  @returns
  {
    [bip353_name]: <Offer BIP 353 Human Readable Name String>
    [expires_at]: <Payer Offer Expires At ISO 8601 Date String>
    [issuer_id]: <Offer Issuer Id Public Key Hex String>
    [offer]: <BOLT 12 Payer Support Offer String>
    [service_id]: <Support Offer Service Id Hex String>
    [service_sequence]: <Support Offer Service Sequence String>
  }
*/
module.exports = args => {
  // Exit early when the whole offer is sent
  if (!args.bip353_name) {
    return {expires_at: args.expires_at, offer: args.offer};
  }

  const label = readServiceLabel({offer: args.offer});

  return {
    bip353_name: args.bip353_name,
    expires_at: args.expires_at,
    issuer_id: args.issuer_id,
    service_id: label.id,
    service_sequence: !label.id ? undefined : label.sequence,
  };
};
