const {typePayerOfferExpiry} = require('./constants');
const {typePayerOfferIssuerId} = require('./constants');
const {typePayerOfferName} = require('./constants');
const {typePayerOfferOffer} = require('./constants');
const {typePayerOfferServiceId} = require('./constants');
const {typePayerOfferServiceSequence} = require('./constants');
const {typePayerOfferSignature} = require('./constants');

/** Record types of a payer offer that are known

  [<Payer Offer Record Type Number String>]
*/
module.exports = [
  typePayerOfferExpiry,
  typePayerOfferIssuerId,
  typePayerOfferName,
  typePayerOfferOffer,
  typePayerOfferServiceId,
  typePayerOfferServiceSequence,
  typePayerOfferSignature,
];
