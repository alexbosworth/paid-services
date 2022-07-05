const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const interval = 500;
const times = 2 * 60 * 5;

/** Peer up with group channel partners

  {
    inbound: <Inbound Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    outbound: <Outbound Identity Public Key Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = ({inbound, lnd, outbound}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!inbound) {
          return cbk([400, 'ExpectedInboundPeerIdentityToConnectTo']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToConnectTo']);
        }

        if (!outbound) {
          return cbk([400, 'ExpectedOutboundPeerIdentityToConnectTo']);
        }

        return cbk();
      },

      // Attempt connecting to the inbound peer
      connectInbound: ['validate', ({}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return connectPeer({lnd, id: inbound}, cbk);
        },
        cbk);
      }],

      // Attempt connecting to the outbound peer
      connectOutbound: ['validate', ({}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return connectPeer({lnd, id: outbound}, cbk);
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
