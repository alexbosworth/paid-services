const asyncAuto = require('async/auto');
const {closeChannel} = require('ln-service');
const {decodeChanId} = require('bolt07');
const {getChainFeeRate} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getHeight} = require('ln-service');
const {getPendingChannels} = require('ln-service');
const {openChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {Transaction} = require('bitcoinjs-lib');

const assembleReplacementTx = require('./assemble_replacement_tx');
const feeForReplacement = require('./fee_for_replacement');
const signCapacityReplacement = require('./sign_capacity_replacement');

const blocksBuffer = 2e3;
const bufferAsHex = buffer => buffer.toString('hex');
const defaultIncrease = 0;
const {fromHex} = Transaction;
const fuzzBlocks = 10;
const highValue = 3000;
const {isArray} = Array;
const maxCommitmentOutputs = 4;
const maxHighValueOutputs = 2;
const notFoundIndex = -1;
const positive = n => Math.max(1, n);
const slowTarget = 1000;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const txIdAsHash = id => Buffer.from(id, 'hex').reverse();

/** Close a channel and get a capacity replacement transaction

  {
    [add_funds_transaction_id]: <Adding Funds Input Tx Id Hex Encoded String>
    [add_funds_transaction_vout]: <Adding Funds Output Index Number>
    bitcoinjs_network: <BitcoinJs Network Name String>
    decrease: [{
      address: <Spend to Chain Address String>
      output: <Spend to Output Script Hex String>
      tokens: <Spend Value Number>
    }]
    id: <Original Channel Standard Format Channel Id String>
    [increase]: <Increase Channel Size Tokens Number>
    [is_private]: <Original Channel Is Private Bool>
    lnd: <Authenticated LND API Object>
    transaction_id: <Original Funding Transaction Id Hex String>
    transaction_vout: <Original Funding Output Index Number>
  }

  @returns via cbk or Promise
  {
    [add_funds_vin]: <Funding Spend Input Index Number>
    capacity: <Replacement Channel Capacity Tokens Number>
    remote_balance: <Initial Balance for Peer Tokens Number>
    signature: <Signature for Replacement Transaction Hex Encoded String>
    signing_key: <Signing Public Key Hex String>
    pending_channel_id: <Proposed Channel Pending Id Hex String>
    transaction_id: <Replacement Channel Transaction Id Hex String>
    transaction_vin: <Original Channel Input Index Number>
    transaction_vout: <Replacement Channel Transaction Output Index Number>
    unsigned_transaction: <Unsigned Transaction Hex Encoded String>
    witness_script: <Original Channel Witness Script Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.bitcoinjs_network) {
          return cbk([400, 'ExpectedNetworkNameToGetCapacityReplacement']);
        }

        if (!isArray(args.decrease)) {
          return cbk([400, 'ExpectedDecreaseArrayToGetCapacityReplacement']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndApiToGetCapacityReplacement']);
        }

        if (!args.transaction_id) {
          return cbk([400, 'ExpectedFundingTxIdToGetCapacityReplacement']);
        }

        if (args.transaction_vout === undefined) {
          return cbk([400, 'ExpectedFundingOutIndexToGetCapacityReplacement']);
        }

        return cbk();
      },

      // Get the chain fee rate for a slow confirmation to calculate fee delta
      getFeeRate: ['validate', ({}, cbk) => {
        return getChainFeeRate({
          confirmation_target: slowTarget,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Get the current chain height
      getHeight: ['validate', ({}, cbk) => getHeight({lnd: args.lnd}, cbk)],

      // Force close the channel in order to get a non-final sequence number
      channelClose: ['getFeeRate', ({}, cbk) => {
        return closeChannel({
          lnd: args.lnd,
          is_force_close: true,
          transaction_id: args.transaction_id,
          transaction_vout: args.transaction_vout,
        },
        cbk);
      }],

      // Get the pending channels
      getPending: ['channelClose', ({}, cbk) => {
        return getPendingChannels({lnd: args.lnd}, cbk);
      }],

      // Find the pending closing channel
      pendingChannel: ['getPending', ({getPending}, cbk) => {
        const channel = getPending.pending_channels.find(chan => {
          if (chan.transaction_id !== args.transaction_id) {
            return false;
          }

          return chan.transaction_vout === args.transaction_vout;
        });

        if (!channel) {
          return cbk([503, 'FailedToFindPendingCloseChannelForReplacement']);
        }

        if (!!channel.pending_payments && !!channel.pending_payments.length) {
          return cbk([503, 'ExpectedNoActiveHtlcsOnCapacityChangeChannel']);
        }

        return cbk(null, {
          capacity: channel.capacity,
          partner_public_key: channel.partner_public_key,
          remote_balance: channel.remote_balance,
        });
      }],

      // Get the chain transactions to pull out the raw close tx
      getUpdatedTx: ['channelClose', 'getHeight', ({getHeight}, cbk) => {
        return getChainTransactions({
          after: getHeight.current_block_height - fuzzBlocks,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Find the force close transaction
      closeTx: [
        'channelClose',
        'getUpdatedTx',
        'pendingChannel',
        ({channelClose, getUpdatedTx, pendingChannel}, cbk) =>
      {
        const closeId = channelClose.transaction_id;
        const id = args.transaction_id;
        const {capacity} = pendingChannel;

        const tx = getUpdatedTx.transactions.find(n => n.id === closeId);

        if (!tx || !tx.transaction) {
          return cbk([503, 'ExpectedCloseTransactionInTransactionsList']);
        }

        const commitment = fromHex(tx.transaction);

        // Make sure there aren't unexpectedly too-many outputs
        if (commitment.outs.length > maxCommitmentOutputs) {
          return cbk([503, 'ExpectedFewerOutputsOnCommitmentTransaction']);
        }

        const highValueOuts = commitment.outs.filter(n => n.value > highValue);

        // There shouldn't be many high value outputs
        if (highValueOuts.length > maxHighValueOutputs) {
          return cbk([500, 'ExpectedFewerHighValueOutputsOnCommitTx']);
        }

        // Input details for the commitment transaction
        const [{hash, index, witness}, other] = commitment.ins;

        // The commitment transaction should be spending the funding outpoint
        if (!hash.equals(txIdAsHash(id)) || index !== args.transaction_vout) {
          return cbk([503, 'ExpectedSpendingOpenTransactionOutputIndex']);
        }

        // There should be no other inputs on the closing tx
        if (!!other) {
          return cbk([503, 'ExpectedSingleInputForCloseTransaction']);
        }

        // The spending script is the final element in the witness
        const [fundingScript] = witness.slice().reverse();

        // The difference between commitment outputs and its input is the fee
        const fee = capacity - sumOf(commitment.outs.map(n => n.value));

        return cbk(null, {
          fee,
          id: commitment.getId(),
          script: bufferAsHex(fundingScript),
          transaction: tx.transaction,
          weight: commitment.weight(),
        });
      }],

      // Find the open transaction
      openTx: ['getUpdatedTx', ({getUpdatedTx}, cbk) => {
        const funding = fromHex(args.open_transaction);
        const id = args.transaction_id;

        if (!funding.outs[args.transaction_vout]) {
          return cbk([503, 'ExpectedTransactionOutputOnFundingTransaction']);
        }

        const capacity = funding.outs[args.transaction_vout].value;
        const output = bufferAsHex(funding.outs[args.transaction_vout].script);

        return cbk(null, {capacity, output});
      }],

      // Calculate the new channel's capacity
      newCapacity: [
        'closeTx',
        'getFeeRate',
        'pendingChannel',
        ({closeTx, getFeeRate, pendingChannel}, cbk) =>
      {
        // The fee for the replacement tx must meet the relay rate minimum
        const {fee} = feeForReplacement({
          capacity: pendingChannel.capacity,
          commit_transaction_fee: closeTx.fee,
          commit_transaction_weight: closeTx.weight,
          decrease: args.decrease,
          increase: args.increase,
          tokens_per_vbyte: getFeeRate.tokens_per_vbyte,
        });

        // The new capacity is capacity + increase - decreases - tx fee
        const newCapacity = sumOf([
          pendingChannel.capacity,
          args.increase || defaultIncrease,
          -sumOf(args.decrease.map(n => n.tokens)),
          -fee,
        ]);

        return cbk(null, newCapacity);
      }],

      // Propose the new channel to replace the existing one
      proposeChannel: [
        'newCapacity',
        'pendingChannel',
        ({newCapacity, pendingChannel}, cbk) =>
      {
        return openChannels({
          channels: [{
            capacity: newCapacity,
            give_tokens: pendingChannel.remote_balance,
            is_private: args.is_private,
            partner_public_key: pendingChannel.partner_public_key,
          }],
          is_avoiding_broadcast: true,
          lnd: args.lnd,
        },
        cbk);
      }],

      // Put together the unsigned replacement transaction
      replacementTx: [
        'closeTx',
        'newCapacity',
        'proposeChannel',
        ({closeTx, newCapacity, proposeChannel}, cbk) =>
      {
        // The replacement tx pays to the proposed channel multisig address
        const [{address}] = proposeChannel.pending;

        try {
          const replacement = assembleReplacementTx({
            add_funds_transaction_id: args.add_funds_transaction_id,
            add_funds_transaction_vout: args.add_funds_transaction_vout,
            bitcoinjs_network: args.bitcoinjs_network,
            close_transaction: closeTx.transaction,
            decrease: args.decrease.map(decrease => ({
              output: decrease.output,
              tokens: decrease.tokens,
            })),
            funding_address: address,
            funding_tokens: newCapacity,
            transaction_id: args.transaction_id,
            transaction_vout: args.transaction_vout,
          });

          return cbk(null, {
            add_funds_vin: replacement.add_funds_vin,
            transaction: replacement.transaction,
            transaction_vin: replacement.transaction_vin,
            transaction_id: replacement.transaction_id,
            transaction_vout: replacement.transaction_vout,
          });
        } catch (err) {
          return cbk([503, err.message]);
        }
      }],

      // Partially sign the replacement transaction using the 2:2 key
      signReplacement: [
        'closeTx',
        'openTx',
        'pendingChannel',
        'replacementTx',
        ({closeTx, openTx, pendingChannel, replacementTx}, cbk) =>
      {
        return signCapacityReplacement({
          capacity: openTx.capacity,
          lnd: args.lnd,
          output: openTx.output,
          script: closeTx.script,
          transaction: replacementTx.transaction,
          vin: replacementTx.transaction_vin,
        },
        cbk);
      }],

      // Details of proposed replacement
      proposedReplacement: [
        'closeTx',
        'newCapacity',
        'pendingChannel',
        'proposeChannel',
        'replacementTx',
        'signReplacement',
        ({
          closeTx,
          newCapacity,
          pendingChannel,
          proposeChannel,
          replacementTx,
          signReplacement,
        },
        cbk) =>
      {
        const [pending] = proposeChannel.pending;

        return cbk(null, {
          add_funds_vin: replacementTx.add_funds_vin,
          capacity: newCapacity,
          force_close_tx_id: closeTx.id,
          remote_balance: pendingChannel.remote_balance,
          signature: signReplacement.signature,
          signing_key: signReplacement.key,
          pending_channel_id: pending.id,
          transaction_id: replacementTx.transaction_id,
          transaction_vin: replacementTx.transaction_vin,
          transaction_vout: replacementTx.transaction_vout,
          unsigned_transaction: replacementTx.transaction,
          witness_script: closeTx.script,
        });
      }],
    },
    returnResult({reject, resolve, of: 'proposedReplacement'}, cbk));
  });
};
