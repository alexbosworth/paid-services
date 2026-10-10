const {randomBytes} = require('node:crypto');

const asyncAuto = require('async/auto');
const {createOffer} = require('invoices');
const {getNetwork} = require('ln-sync');
const {getPublicKey} = require('ln-service');
const {parseOffer} = require('invoices');
const {returnResult} = require('asyncjs-util');

const addOfferRecords = require('./add_offer_records');
const {addServiceLabel} = require('./../service_records');
const {createNetworkPath} = require('./../network');
const decodeSupportRecord = require('./decode_support_record');
const {derivedKeyFamily} = require('./constants');
const encodeSuggestedAmounts = require('./encode_suggested_amounts');
const encodeSupportRecord = require('./encode_support_record');
const {getRecordKey} = require('./../service_records');
const {minPathIdBytes} = require('./constants');
const {readRecordKeyIndex} = require('./../service_records');
const {recordVersion} = require('./constants');
const {serviceIdBytes} = require('./constants');
const {serviceTypes} = require('./../service_records');
const {typeOfferSuggestedAmounts} = require('./constants');

const {isArray} = Array;
const {isSafeInteger} = Number;
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const isLimit = n => n === undefined || (isSafeInteger(n) && n > 0);
const isPathId = n => isHex(n) && n.length / 2 >= minPathIdBytes;
const isSequence = n => n === undefined || (isSafeInteger(n) && n >= 0);
const isServiceId = n => isHex(n) && n.length / 2 === serviceIdBytes;

/** Create a support offer for supporters to pay, to be serviced with
  `serviceSupportOffer`

  The supporter chooses the amount to pay, and the offer does not expire.

  The offer has blinded paths to self. Give `paths` made to self, each with
  the `id` given to self in its final hop, at least 16 random bytes kept
  private, to keep the node private. Otherwise a path that starts at self is
  created. Keep the offer small, with one path, so that its invoices fit in
  onion messages of the regular size.

  The offer has its own issuer id, a derived key that is not linked to the
  node identity. Give the record of another support offer as the
  `issuer_record` to use its issuer id, like for offers listed on each
  other's menus.

  The offer is labeled as a support offer with a random 16 byte `service_id`.
  To change an offer and keep it the same support offer, give its
  `issuer_record` and `service_id`, with a higher `service_sequence` when
  anything other than its paths changes. A copy with only other paths keeps
  the `service_sequence`, which is zero when it is not given.

  `suggested_mtokens` are totals that wallets can show as choices to pay. To
  suggest amounts in a currency, give `suggested_amounts` in the minor units
  of the ISO 4217 `suggested_currency` instead.

  The `record` is what `serviceSupportOffer` needs to service the offer. It
  is sealed with the record key at `record_key_index`, zero by default, so
  store it to resume servicing the offer later.

  {
    [description]: <Offer Description String>
    [issuer]: <Issuer Identifier String>
    [issuer_record]: <Use Issuer Id of Support Record Hex String>
    lnd: <Authenticated LND API Object>
    [max_requests_per_hour]: <Maximum Requests Answered Per Hour Number>
    [max_unpaid_invoices_per_hour]: <Maximum Unpaid Invoices Per Hour Number>
    [paths]: [{
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      id: <Random Path Identifier Given To Self Hex String>
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
    }]
    [record_key_index]: <Seal Record With Record Key Index Number>
    [service_id]: <Keep Support Offer Service Id Hex String>
    [service_sequence]: <Support Offer Service Sequence Number>
    [suggested_amounts]: [<Suggested Amount in Currency Minor Units String>]
    [suggested_currency]: <Suggested Amounts ISO 4217 Currency Code String>
    [suggested_mtokens]: [<Suggested Amount Millitokens String>]
  }

  @returns via cbk or Promise
  {
    offer: <BOLT 12 Offer String>
    record: <Support Service Record Hex String>
    service_id: <Support Offer Service Id Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!!args.issuer_record && typeof args.issuer_record !== 'string') {
          return cbk([400, 'ExpectedIssuerRecordForSupportOffer']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToCreateSupportOffer']);
        }

        if (args.service_id !== undefined && !isServiceId(args.service_id)) {
          return cbk([400, 'ExpectedServiceIdToCreateSupportOffer']);
        }

        if (!isSequence(args.service_sequence)) {
          return cbk([400, 'ExpectedServiceSequenceToCreateSupportOffer']);
        }

        if (!isLimit(args.max_requests_per_hour)) {
          return cbk([400, 'ExpectedPositiveMaxRequestsForSupportOffer']);
        }

        if (!isLimit(args.max_unpaid_invoices_per_hour)) {
          return cbk([400, 'ExpectedPositiveMaxUnpaidForSupportOffer']);
        }

        if (!!args.paths && !isArray(args.paths)) {
          return cbk([400, 'ExpectedArrayOfPathsForSupportOffer']);
        }

        if (!!args.suggested_mtokens && !!args.suggested_amounts) {
          return cbk([400, 'ExpectedEitherSuggestedMtokensOrAmounts']);
        }

        if (!!args.suggested_amounts !== !!args.suggested_currency) {
          return cbk([400, 'ExpectedSuggestedAmountsWithTheirCurrency']);
        }

        if (!!args.suggested_mtokens && !!args.suggested_mtokens.length) {
          try {
            encodeSuggestedAmounts({amounts: args.suggested_mtokens});
          } catch (err) {
            return cbk([400, 'ExpectedSuggestedAmountsForSupportOffer']);
          }
        }

        if (!!args.suggested_amounts) {
          try {
            encodeSuggestedAmounts({
              amounts: args.suggested_amounts,
              currency: args.suggested_currency,
            });
          } catch (err) {
            return cbk([400, 'ExpectedSuggestedAmountsForSupportOffer']);
          }
        }

        // Exit early when there are no given paths to check
        if (!args.paths) {
          return cbk();
        }

        if (!args.paths.length) {
          return cbk([400, 'ExpectedGivenPathsForSupportOffer']);
        }

        if (!args.paths.every(n => !!n && isHex(n.id))) {
          return cbk([400, 'ExpectedPathIdForGivenSupportOfferPath']);
        }

        // Path ids are at least 16 random bytes, so they cannot be guessed
        if (!args.paths.every(n => isPathId(n.id))) {
          return cbk([400, 'ExpectedPathIdOfAtLeast16BytesForGivenPath']);
        }

        if (new Set(args.paths.map(n => n.id)).size !== args.paths.length) {
          return cbk([400, 'ExpectedUniquePathIdsForSupportOfferPaths']);
        }

        if (!args.paths.every(n => isArray(n.hops) && !!n.hops.length)) {
          return cbk([400, 'ExpectedHopsInGivenSupportOfferPath']);
        }

        // A path starts at an introduction node or an introduction edge
        const introductions = args.paths.map(n => {
          return n.introduction_edge || n.introduction_node;
        });

        if (!introductions.every(n => !!n)) {
          return cbk([400, 'ExpectedIntroductionInGivenSupportOfferPath']);
        }

        if (!args.paths.every(n => isHex(n.key))) {
          return cbk([400, 'ExpectedPathKeyInGivenSupportOfferPath']);
        }

        return cbk();
      },

      // Get the network of the node
      getNetwork: ['validate', ({}, cbk) => getNetwork({lnd: args.lnd}, cbk)],

      // Get the key to seal the support record with
      getRecordKey: ['validate', ({}, cbk) => {
        return getRecordKey({
          index: args.record_key_index,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get the key that the record of the offer to share an issuer with uses
      getIssuerRecordKey: ['validate', ({}, cbk) => {
        // Exit early when the offer gets its own issuer id
        if (!args.issuer_record) {
          return cbk();
        }

        try {
          const {index} = readRecordKeyIndex({record: args.issuer_record});

          return getRecordKey({index, lnd: args.lnd}, cbk);
        } catch (err) {
          return cbk([400, 'ExpectedValidIssuerRecordForSupportOffer']);
        }
      }],

      // Read the record of the offer to share an issuer id with
      issuerRecord: ['getIssuerRecordKey', ({getIssuerRecordKey}, cbk) => {
        // Exit early when the offer gets its own issuer id
        if (!args.issuer_record) {
          return cbk();
        }

        try {
          return cbk(null, decodeSupportRecord({
            key: getIssuerRecordKey.key,
            record: args.issuer_record,
          }));
        } catch (err) {
          return cbk([400, 'ExpectedValidIssuerRecordForSupportOffer']);
        }
      }],

      // Get the key for the offer to sign invoices with
      getKey: ['issuerRecord', ({issuerRecord}, cbk) => {
        // Exit early and get a new derived key when there is no issuer record
        if (!issuerRecord) {
          return getPublicKey({family: derivedKeyFamily, lnd: args.lnd}, cbk);
        }

        return getPublicKey({
          family: derivedKeyFamily,
          index: issuerRecord.key_index,
          lnd: args.lnd,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const {issuer_id} = parseOffer({offer: issuerRecord.offer});

          // The key of the issuer record is its offer issuer id
          if (res.public_key !== issuer_id) {
            return cbk([400, 'ExpectedIssuerRecordKeyForItsOfferIssuerId']);
          }

          return cbk(null, {index: issuerRecord.key_index, ...res});
        });
      }],

      // Create a blinded path to self to receive invoice requests on
      createPath: ['validate', ({}, cbk) => {
        // Exit early when the paths to use are given
        if (!!args.paths) {
          return cbk();
        }

        return createNetworkPath({lnd: args.lnd}, cbk);
      }],

      // Create the offer
      create: [
        'createPath',
        'getKey',
        'getNetwork',
        'getRecordKey',
        ({createPath, getKey, getNetwork, getRecordKey}, cbk) =>
      {
        // Offer networks are named the same as bitcoinjs networks
        if (!getNetwork.bitcoinjs) {
          return cbk([400, 'ExpectedBitcoinNetworkToCreateSupportOffer']);
        }

        // Given paths have their path id beside the path
        const givenPaths = (args.paths || []).map(n => {
          const {id, ...path} = n;

          return {id, path};
        });

        // The offer paths are the given paths or the created path
        const offerPaths = !args.paths ? [createPath] : givenPaths;

        try {
          const unlabeled = createOffer({
            description: args.description,
            issuer: args.issuer,
            issuer_id: getKey.public_key,
            networks: [getNetwork.bitcoinjs],
            paths: offerPaths.map(n => n.path),
          });

          // The service id stays the same when the offer is changed
          const id = args.service_id || (
            bufferAsHex(randomBytes(serviceIdBytes))
          );

          // The offer is labeled with its service type, version, and id
          const labeled = addServiceLabel({
            id: id.toLowerCase(),
            offer: unlabeled.offer,
            sequence: args.service_sequence,
            type: serviceTypes.support,
            version: recordVersion,
          });

          const amounts = args.suggested_amounts || (
            args.suggested_mtokens || []
          );

          // Suggested amounts are in their own offer record
          const withAmounts = () => addOfferRecords({
            offer: labeled.offer,
            records: [{
              type: typeOfferSuggestedAmounts,
              value: encodeSuggestedAmounts({
                amounts,
                currency: args.suggested_currency,
              })
              .encoded,
            }],
          });

          const {offer} = !amounts.length ? labeled : withAmounts();

          // The record has what is needed to service the offer
          const {record} = encodeSupportRecord({
            offer,
            key: getRecordKey.key,
            key_index: getKey.index,
            max_requests_per_hour: args.max_requests_per_hour,
            max_unpaid_invoices_per_hour: args.max_unpaid_invoices_per_hour,
            path_ids: offerPaths.map(n => n.id),
            record_key_index: getRecordKey.index,
          });

          return cbk(null, {offer, record, service_id: id.toLowerCase()});
        } catch (err) {
          return cbk([400, 'FailedToCreateSupportOffer', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'create'}, cbk));
  });
};
