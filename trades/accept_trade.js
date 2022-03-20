const {acceptsChannelOpen} = require('ln-sync');
const asyncAuto = require('async/auto');
const asyncEach = require('async/each');
const {cancelHodlInvoice} = require('ln-service');
const {getChainFeeRate} = require('ln-service');
const {getInvoice} = require('ln-service');
const {openChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {settleHodlInvoice} = require('ln-service');

const {isArray} = Array;
const slowConf = 144;

/** Accept an open ended trade

  {
    cancel: [<Alternative Invoice Id Hex String>]
    [channel]: <Channel Capacity Tokens Number>
    from: <Trade With Node Identity Public Key Hex String>
    id: <Trade Id Hex String>
    lnd: <Authenticated LND API Object>
    secret: <Invoice to Settle Preimage Hex String>
  }

  @returns via cbk or Promise
  {
    [opening_channel]: {
      fee_tokens_per_vbyte: <Chain Fee Rate Number>
      transaction_id: <Channel Funding Transaction Id Hex String>
      transaction_vout: <Channel Funding Transaction Output Index Number>
    }
  }
*/
module.exports = ({cancel, channel, from, id, lnd, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(cancel)) {
          return cbk([400, 'ExpectedArrayOfIdsToCancelToAcceptTrade']);
        }

        if (!from) {
          return cbk([400, 'ExpectedWithPeerPublicKeyToAcceptTrade']);
        }

        if (!id) {
          return cbk([400, 'ExpectedAnchorTradeIdToAcceptTrade']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToAcceptTrade']);
        }

        if (!secret) {
          return cbk([400, 'ExpectedSettlementPreimageToAcceptTrade']);
        }

        return cbk();
      },

      // Fetch the anchor invoice to make sure it's still open
      getAnchor: ['validate', ({}, cbk) => getInvoice({id, lnd}, cbk)],

      // Get the chain fee rate for channel opening trades
      getFeeRate: ['validate', ({}, cbk) => {
        // Exit early when not trading a channel open
        if (!channel) {
          return cbk();
        }

        return getChainFeeRate({lnd, confirmation_target: slowConf}, cbk);
      }],

      // Cancel alternative invoices so that only one resolves as settled
      cancel: ['getAnchor', ({getAnchor}, cbk) => {
        if (!!getAnchor.is_canceled) {
          return cbk([404, 'OpenTradeNotFound']);
        }

        return asyncEach([].concat(cancel).concat(id), (alternative, cbk) => {
          return cancelHodlInvoice({lnd, id: alternative}, cbk);
        },
        cbk);
      }],

      // Check opening for channel trades
      acceptsOpen: ['cancel', ({}, cbk) => {
        // Exit early when not opening a channel
        if (!channel) {
          return cbk();
        }

        return acceptsChannelOpen({
          lnd,
          capacity: channel,
          partner_public_key: from,
        },
        cbk);
      }],

      // Settle the held invoice with the preimage
      settle: ['acceptsOpen', 'cancel', 'getFeeRate', ({}, cbk) => {
        return settleHodlInvoice({lnd, secret}, cbk);
      }],

      // Open the channel
      openChannel: ['getFeeRate', 'settle', ({getFeeRate}, cbk) => {
        // Exit early when this is not a channel trade
        if (!channel) {
          return cbk();
        }

        return openChannel({
          lnd,
          chain_fee_rate: getFeeRate.tokens_per_vbyte,
          local_tokens: channel,
          partner_public_key: from,
        },
        cbk);
      }],

      // Trade is settled
      settled: [
        'getFeeRate',
        'openChannel',
        ({getFeeRate, openChannel}, cbk) =>
      {
        // Exit early when there is no trade result
        if (!openChannel) {
          return cbk(null, {});
        }

        return cbk(null, {
          opening_channel: {
            fee_tokens_per_vbyte: getFeeRate.tokens_per_vbyte,
            transaction_id: openChannel.transaction_id,
            transaction_vout: openChannel.transaction_vout,
          },
        });
      }],
    },
    returnResult({reject, resolve, of: 'settled'}, cbk));
  });
};
