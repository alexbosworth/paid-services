const asyncAuto = require('async/auto');
const {getPublicKey} = require('ln-service');
const {parseOffer} = require('invoices');
const {returnResult} = require('asyncjs-util');
const {signBytes} = require('ln-service');

const decodeSupportRecord = require('./decode_support_record');
const {derivedKeyFamily} = require('./constants');
const encodePayerOffer = require('./encode_payer_offer');
const {getRecordKey} = require('./../service_records');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const payerOfferArgs = require('./payer_offer_args');
const {readRecordKeyIndex} = require('./../service_records');
const signaturePreimage = require('./payer_offer_signature_preimage');

const isDate = n => typeof n === 'string' && !isNaN(Date.parse(n));
const isExpired = date => Date.parse(date) <= Date.now();
const isKey = n => typeof n === 'string' && /^0[23][0-9a-f]{64}$/i.test(n);
const isName = n => typeof n === 'string' && namePattern.test(n);
const namePattern = /^[0-9a-zA-Z\-_.]+@[0-9a-zA-Z\-_.]+$/;
const typeSchnorr = 'schnorr';

/** Sign the support offer of a payer to send with a payment

  The support offer and its `record` are from `createSupportOffer`. The
  payer offer is signed by its offer issuer id key over the network of the
  offer, the `payer_id` of the invoice request to pay with, and the payer
  offer, so that the recipient can see that the holder of the offer
  authorized that payer id to present it.

  Give a `bip353_name` where the offer can be found to send a much smaller
  reference to the offer instead of the whole offer. Give an `expires_at`
  date to have the recipient ignore the payer offer after it.

  Add the returned record to the invoice request before it is signed with
  the key of `payer_id`. Only send it when the payer chooses to, since the
  recipient learns the offer.

  {
    [bip353_name]: <Offer BIP 353 Human Readable Name String>
    [expires_at]: <Payer Offer Expires At ISO 8601 Date String>
    lnd: <Authenticated LND API Object>
    payer_id: <Invoice Request Payer Id Public Key Hex String>
    record: <Payer Support Service Record Hex String>
  }

  @returns via cbk or Promise
  {
    offer: <BOLT 12 Payer Support Offer String>
    type: <Invoice Request Record Type Number String>
    value: <Invoice Request Record Value Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToSignPayerOffer']);
        }

        if (!isKey(args.payer_id)) {
          return cbk([400, 'ExpectedPayerIdToSignPayerOffer']);
        }

        if (!args.record) {
          return cbk([400, 'ExpectedSupportRecordToSignPayerOffer']);
        }

        if (!!args.bip353_name && !isName(args.bip353_name)) {
          return cbk([400, 'ExpectedBip353NameToSignPayerOffer']);
        }

        if (args.expires_at !== undefined && !isDate(args.expires_at)) {
          return cbk([400, 'ExpectedExpiryDateToSignPayerOffer']);
        }

        // A payer offer that has expired would be ignored
        if (!!args.expires_at && isExpired(args.expires_at)) {
          return cbk([400, 'ExpectedFutureExpiryToSignPayerOffer']);
        }

        return cbk();
      },

      // Get the key the record was sealed with
      getRecordKey: ['validate', ({}, cbk) => {
        try {
          const {index} = readRecordKeyIndex({record: args.record});

          return getRecordKey({index, lnd: args.lnd}, cbk);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Open the record to get the offer and its signing key index
      decode: ['getRecordKey', ({getRecordKey}, cbk) => {
        try {
          const {key} = getRecordKey;

          return cbk(null, decodeSupportRecord({key, record: args.record}));
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Get the key of the offer issuer id
      getKey: ['decode', ({decode}, cbk) => {
        return getPublicKey({
          family: derivedKeyFamily,
          index: decode.key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Check the offer can be signed for with the offer issuer id key
      check: ['decode', 'getKey', ({decode, getKey}, cbk) => {
        const {is_expired, issuer_id} = parseOffer({offer: decode.offer});

        // A payer offer for an offer that has expired would be ignored
        if (is_expired) {
          return cbk([400, 'ExpectedUnexpiredOfferToSignPayerOffer']);
        }

        // The key has to be the offer issuer id
        if (getKey.public_key !== issuer_id) {
          return cbk([400, 'ExpectedIssuerIdKeyToSignPayerOffer']);
        }

        const {network} = offerBitcoinNetwork({offer: decode.offer});

        // The signature is for the network of the offer
        if (!network) {
          return cbk([400, 'ExpectedOfferNetworkToSignPayerOffer']);
        }

        return cbk(null, {issuer_id, network});
      }],

      // Encode the payer offer without its signature
      unsigned: ['check', 'decode', ({check, decode}, cbk) => {
        try {
          return cbk(null, encodePayerOffer(payerOfferArgs({
            bip353_name: args.bip353_name,
            expires_at: args.expires_at,
            issuer_id: check.issuer_id,
            offer: decode.offer,
          }))
          .unsigned);
        } catch (err) {
          return cbk([400, 'ExpectedValidPayerOfferToSign']);
        }
      }],

      // Sign the offer and the payer id with the offer issuer id key
      sign: [
        'check',
        'decode',
        'unsigned',
        ({check, decode, unsigned}, cbk) =>
      {
        const {preimage, tag} = signaturePreimage({
          unsigned,
          network: check.network,
          payer_id: args.payer_id,
        });

        return signBytes({
          preimage,
          tag,
          key_family: derivedKeyFamily,
          key_index: decode.key_index,
          lnd: args.lnd,
          type: typeSchnorr,
        },
        cbk);
      }],

      // Make the record to add to the invoice request
      payerOffer: ['check', 'decode', 'sign', ({check, decode, sign}, cbk) => {
        try {
          const {type, value} = encodePayerOffer({
            ...payerOfferArgs({
              bip353_name: args.bip353_name,
              expires_at: args.expires_at,
              issuer_id: check.issuer_id,
              offer: decode.offer,
            }),
            signature: sign.signature,
          });

          return cbk(null, {type, value, offer: decode.offer});
        } catch (err) {
          return cbk([503, 'FailedToEncodePayerOffer', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'payerOffer'}, cbk));
  });
};
