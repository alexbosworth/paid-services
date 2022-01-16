const {acceptsChannelOpen} = require('ln-sync');
const asyncAuto = require('async/auto');
const {connectPeer} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

/** Check that a channel open would be accepted by a node

  {
    capacity: <Capacity Tokens Number>
    id: <Node Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    is_accepted: <Channel Proposal Is Accepted Bool>
  }
*/
module.exports = ({capacity, id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedCapacityTokensToProposeChannelOpen']);
        }

        if (!id) {
          return cbk([400, 'ExpectedNodePublicKeyToProposeChannelOpen']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProposeChannelOpen']);
        }

        return cbk();
      },

      // Connect to the peer
      connect: ['validate', ({}, cbk) => connectPeer({id, lnd}, cbk)],

      // Propose a channel open to check acceptance
      checkAccept: ['connect', ({}, cbk) => {
        return acceptsChannelOpen({
          capacity,
          lnd,
          partner_public_key: id,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'checkAccept'}, cbk));
  });
};
