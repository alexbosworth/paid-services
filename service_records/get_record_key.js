const asyncAuto = require('async/auto');
const {diffieHellmanComputeSecret} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {maxRecordKeyIndex} = require('./constants');
const {recordKeyFamily} = require('./constants');
const recordKeyForSecret = require('./record_key_for_secret');
const recordPoint = require('./record_point');

const {isSafeInteger} = Number;
const defaultIndex = 0;
const partnerPublicKey = recordPoint().public_key;

/** Get the record key of a record key index, derived from a node key that
  only this node can derive it with

  A new index can be used for new records, like after the key of an index
  leaked. An index is below 2^31. Only get the key of an index that is
  accepted.

  {
    [index]: <Record Key Index Number>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    index: <Record Key Index Number>
    key: <Record Key Hex String>
  }
*/
module.exports = ({index, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (index !== undefined && !isSafeInteger(index)) {
          return cbk([400, 'ExpectedNumericIndexToGetServiceRecordKey']);
        }

        if (index !== undefined && index < 0) {
          return cbk([400, 'ExpectedNonNegativeIndexToGetServiceRecordKey']);
        }

        // An index is below 2^31, so it is a valid key index for any signer
        if (index !== undefined && index > maxRecordKeyIndex) {
          return cbk([400, 'ExpectedIndexBelowMaximumToGetServiceRecordKey']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToGetServiceRecordKey']);
        }

        return cbk();
      },

      // Derive the shared secret of the record key and the record point
      getSecret: ['validate', ({}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd,
          key_family: recordKeyFamily,
          key_index: index === undefined ? defaultIndex : index,
          partner_public_key: partnerPublicKey,
        },
        cbk);
      }],

      // Derive the record key from the shared secret
      key: ['getSecret', ({getSecret}, cbk) => {
        try {
          const {key} = recordKeyForSecret({secret: getSecret.secret});

          return cbk(null, {
            key,
            index: index === undefined ? defaultIndex : index,
          });
        } catch (err) {
          return cbk([503, 'FailedToDeriveServiceRecordKey', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'key'}, cbk));
  });
};
