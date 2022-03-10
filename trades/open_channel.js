const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {getPeers} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {openChannel} = require('ln-service');

const slowConf = 144;

/** Opens channel on invoice payment
  {
    id: <Partner Public Key>
    lnd: <Authenticated LND API Object>
    tokens: <Capacity of channel open>
  }

  @returns via cbk or Promise
  {
  transaction_id: <Funding Transaction Id String>
  transaction_vout: <Funding Transaction Output Index Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.id) {
          return cbk([400, 'ExpectedPartnerPublicKeyToOpenNewChannel']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndObjectToOpenNewChannel']);
        }

        if (!args.tokens) {
          return cbk([400, 'ExpectedCapacityToOpenNewChannel']);
        }

        return cbk();
      },

      // Get low fee rate
      getSlowFee: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: slowConf,
          lnd: args.lnd,
        },
        cbk);
      }],

      getSocket: ['validate', ({}, cbk) => {
        return getPeers(
          {
            lnd: args.lnd,
          }, 
          (err, res) => {
            const peer = res.peers.find(n => n.public_key === args.id);
            return cbk(null, {socket: peer.socket});
          });
      }],

      // Select a peer and open a channel
      openChannel: [
        'getSlowFee',
        'getSocket',
        'validate',
        ({getSlowFee, getSocket}, cbk) =>
      {
        return openChannel({
          chain_fee_rate: getSlowFee.tokens_per_vbyte,
          lnd: args.lnd,
          local_tokens: args.tokens,
          partner_public_key: args.id,
          partner_socket: getSocket.socket
        },
        cbk);
      }],

    },
    returnResult({reject, resolve, of: 'openChannel'}, cbk));
  });
};
