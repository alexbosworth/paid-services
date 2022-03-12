const asyncAuto = require('async/auto');
const {getPeers} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {openChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const slowConf = 144;

/** Opens channel on invoice payment
  {
    id: <Partner Public Key Hex String>
    lnd: <Authenticated LND API Object>
    tokens: <Capacity of Channel To Open Tokens Number>
  }

  @returns via cbk or Promise
  {
    transaction_id: <Funding Transaction Id String>
    transaction_vout: <Funding Transaction Output Index Number>
  }
*/
module.exports = ({id, lnd, tokens}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedPartnerPublicKeyToOpenNewChannel']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndObjectToOpenNewChannel']);
        }

        if (!tokens) {
          return cbk([400, 'ExpectedCapacityToOpenNewChannel']);
        }

        return cbk();
      },

      // Get low fee rate
      getSlowFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({lnd, confirmation_target: slowConf}, cbk);
      }],

      // Select a peer and open a channel
      openChannel: ['getSlowFee', ({getSlowFee}, cbk) => {
        return openChannel({
          lnd,
          chain_fee_rate: getSlowFee.tokens_per_vbyte,
          local_tokens: tokens,
          partner_public_key: id,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'openChannel'}, cbk));
  });
};
