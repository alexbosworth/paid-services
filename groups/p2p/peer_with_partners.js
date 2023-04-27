const {acceptsChannelOpen} = require('ln-sync');
const asyncAuto = require('async/auto');
const asyncRetry = require('async/retry');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const interval = 500;
const times = 2 * 60 * 30;

/** Peer up with group channel partners

  {
    capacity: <Channel Capacity Tokens Number>
    [inbound]: <Inbound Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    outbound: <Outbound Identity Public Key Hex String>
  }

  @returns via cbk or Promise
*/
module.exports = ({capacity, inbound, lnd, outbound}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedChannelCapacityToPeerWithPartners']);
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
        // Exit early when there is no inbound peer
        if (!inbound) {
          return cbk();
        }

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

      // Test if outbound peer would accept a channel
      getAcceptance: ['connectOutbound', ({}, cbk) => {
        return acceptsChannelOpen({
          capacity,
          lnd,
          partner_public_key: outbound,
        },
        cbk);
      }],

      // Check that the proposal would be accepted
      checkAcceptance: ['getAcceptance', ({getAcceptance}, cbk) => {
        if (!getAcceptance.is_accepted) {
          return cbk([503, 'PeerRejectedChanOpenRequest', {peer: outbound}]);
        }

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
