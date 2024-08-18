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
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToPeerWithPartners']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToConnectTo']);
        }

        if (!args.outbound) {
          return cbk([400, 'ExpectedOutboundPeerIdentityToConnectTo']);
        }

        return cbk();
      },

      // Attempt connecting to the inbound peer
      connectInbound: ['validate', ({}, cbk) => {
        // Exit early when there is no inbound peer
        if (!args.inbound) {
          return cbk();
        }

        return asyncRetry({interval, times}, cbk => {
          return connectPeer({id: args.inbound, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Attempt connecting to the outbound peer
      connectOutbound: ['validate', ({}, cbk) => {
        return asyncRetry({interval, times}, cbk => {
          return connectPeer({id: args.outbound, lnd: args.lnd}, cbk);
        },
        cbk);
      }],

      // Test if outbound peer would accept a channel
      getAcceptance: ['connectOutbound', ({}, cbk) => {
        return acceptsChannelOpen({
          capacity: args.capacity,
          lnd: args.lnd,
          partner_public_key: args.outbound,
        },
        cbk);
      }],

      // Check that the proposal would be accepted
      checkAcceptance: ['getAcceptance', ({getAcceptance}, cbk) => {
        if (!getAcceptance.is_accepted) {
          return cbk([503, 'PeerRejectedChanOpenRequest', {peer: args.outbound}]);
        }

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
