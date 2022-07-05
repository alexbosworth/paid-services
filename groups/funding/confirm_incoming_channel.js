const asyncAuto = require('async/auto');
const {getPendingChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const half = n => n / 2;

/** Confirm incoming group channel

  {
    capacity: <Channel Capacity Tokens Number>
    from: <Look for Incoming Channel From Identity Public Key Hex String>
    id: <Channel Transaction id Hex String>
    lnd: <Authenticated LND API Object>
    to: <Look for Outgoing Channel To Identity Public Key Hex String>
  }
*/
module.exports = ({capacity, from, id, lnd, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!capacity) {
          return cbk([400, 'ExpectedCapacityToConfirmIncomingGroupChannel']);
        }

        if (!from) {
          return cbk([400, 'ExpectedIncomingIdToConfirmIncomingGroupChannel']);
        }

        if (!id) {
          return cbk([400, 'ExpectedTransactionIdToConfirmIncomingChannel']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToConfirmChannel']);
        }

        if (!to) {
          return cbk([400, "ExpectedToPublicKeyToConfirmIncomingChannel"]);
        }

        return cbk();
      },

      // Get the pending channels
      getPending: ['validate', ({}, cbk) => getPendingChannels({lnd}, cbk)],

      // Find the pending incoming channel
      incoming: ['getPending', ({getPending}, cbk) => {
        const pending = getPending.pending_channels.find(channel => {
          return channel.is_partner_initiated && channel.transaction_id === id;
        });

        // Make sure there is a pending channel for the transaction
        if (!pending || !pending.is_opening) {
          return cbk([503, 'FailedToFindIncomingPendingChannelWithTxId']);
        }

        // Make sure the channel is the expected size
        if (pending.capacity !== capacity) {
          return cbk([503, 'FailedToFindIncomingPendingChannelWithCapacity']);
        }

        // Make sure the channel has the starting balance
        if (pending.local_balance !== half(capacity)) {
          return cbk([503, 'FailedToFindIncomingChannelWithLocalBalance']);
        }

        // Make sure the channel is from the inbound peer
        if (pending.partner_public_key !== from) {
          return cbk([503, 'FailedToFindIncomingChannelFromSpecifiedPeer']);
        }

        return cbk();
      }],

      // Double check that there is also a twin outgoing channel
      outgoing: ['getPending', ({getPending}, cbk) => {
        const pending = getPending.pending_channels.find(chan => {
          return !chan.is_partner_initiated && chan.transaction_id === id;
        });

        // Make sure there is a pending channel for the transaction
        if (!pending || !pending.is_opening) {
          return cbk([503, 'FailedToFindOutgoingPendingChannelWithTxId']);
        }

        // Make sure the channel is the expected size
        if (pending.capacity !== capacity) {
          return cbk([503, 'FailedToFindOutgoingPendingChannelWithCapacity']);
        }

        // Make sure the channel has the starting remote balance
        if (pending.remote_balance !== half(capacity)) {
          return cbk([503, 'FailedToFindOutgoingChannelWithRemoteBalance']);
        }

        // Make sure the channel is to the outbound peer
        if (pending.partner_public_key !== to) {
          return cbk([503, 'FailedToFindOutgoingChannelToSpecifiedPeer']);
        }

        return cbk();
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
