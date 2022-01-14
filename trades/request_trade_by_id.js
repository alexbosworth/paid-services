const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const decodeTrade = require('./decode_trade');
const {makePeerRequest} = require('./../p2p');

const findTradeRecord = records => records.find(n => n.type === '1');
const requestTradeTimeoutMs = 1000 * 30;
const {serviceTypeRequestTrades} = require('./../service_types');
const tradeIdRecordType = '0';

/** Request a specific trade by its id

  {
    id: <Trade Identifier Hex String>
    lnd: <Authenticated LND API Object>
    to: <Make Request To Public Key Hex Encoded String>
  }

  @returns via cbk or Promise
  {
    auth: <Encrypted Payload Auth Hex String>
    payload: <Preimage Encrypted Payload Hex String>
    request: <BOLT 11 Payment Request String>
    trade: <Encoded Trade Record String>
  }
*/
module.exports = ({id, lnd, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedTradeIdentifierToRequestTradeById']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToRequestTradeById']);
        }

        if (!to) {
          return cbk([400, 'ExpectedRemotePublicKeyToRequestTradeById']);
        }

        return cbk();
      },

      // Get trade
      getTrade: ['validate', ({}, cbk) => {
        return makePeerRequest({
          lnd,
          to,
          records: [{type: tradeIdRecordType, value: id}],
          timeout: requestTradeTimeoutMs,
          type: serviceTypeRequestTrades,
        },
        (err, res) => {
          if (!!err) {
            return cbk(err);
          }

          const tradeRecord = findTradeRecord(res.records);

          if (!tradeRecord) {
            return cbk([503, 'ExpectedTradeRecordFromPeer']);
          }

          try {
            decodeTrade({trade: tradeRecord.value});
          } catch (err) {
            return cbk([503, err.message]);
          }

          const {secret} = decodeTrade({trade: tradeRecord.value});

          if (!secret) {
            return cbk([503, 'ExpectedTradeSecretInResponseForTradeById']);
          }

          try {
            return cbk(null, {
              auth: secret.auth,
              payload: secret.payload,
              request: secret.request,
              trade: tradeRecord.value,
            });
          } catch (err) {
            return cbk([503, 'ExpectedValidTradeRecordFromPeer', {err}]);
          }
        });
      }],
    },
    returnResult({reject, resolve, of: 'getTrade'}, cbk));
  });
};
