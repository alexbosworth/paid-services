const asyncAuto = require('async/auto');
const asyncUntil = require('async/until');
const {connectPeer} = require('ln-sync');
const {findKey} = require('ln-sync');
const {getChainFeeRate} = require('ln-service');
const {getChainTransactions} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {getNodeAlias} = require('ln-sync');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');

const askForDecrease = require('./ask_for_decrease');
const encodeChangeRequest = require('./encode_change_request');
const feeForReplacement = require('./fee_for_replacement');

const {ceil} = Math;
const dust = 550;
const dustBuffer = 750;
const {isArray} = Array;
const isNumber = n => !isNaN(n);
const largeChannelsBit = 19;
const maxSats = 21e6 * 1e8;
const maxSize = 16777215;
const minNewLocalBalance = 0;
const nonNegative = n => Math.max(0, n);
const outputSize = 44;
const positive = n => Math.max(1, n);
const privateType = 1;
const publicType = 0;
const slowTarget = 1000;
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const sumOfTokens = arr => arr.reduce((sum, n) => sum + n.tokens, 0);
const testMessage = '00';
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);
const weightAsVBytes = n => n / 4;
const weightBuffer = 150;

/** Ask for change details

  {
    ask: <Ask Function>
    id: <Request Identifier Hex String>
    lnd: <Authenticated LND API Object>
    nodes: [{
      lnd: <Potential Move Node LND API Object>
      node_name: <Potential Move Node Name String>
      public_key: <Potential Move Node Public Key Hex String>
    }]
  }

  @returns via cbk or Promise
  {
    base_fee_mtokens: <Base Fee Millitokens String>
    cltv_delta: <Locktime Delta Number>
    coop_close_address: <Cooperative Close Address String>
    decrease: [{
      [address]: <Decrease Address String>
      [node]: <Create Channel with Node With Public Key Hex String>
      [output]: <Output Script Hex String>
      tokens: <Decrease Tokens Number>
    }]
    estimated_capacity: <Estimated Tokens For New Channel Capacity Number>
    estimated_local_delta: <Estimated Local Balance Delta Tokens Number>
    fee_rate: <Fees Charged in Millitokens Per Million Number>
    id: <Standard Format Channel Id String>
    increase: <Channel Capacity Increase Tokens Number>
    is_private: <Channel is Private Bool>
    [open_from]: <Open Replacement Channel From Node with Public Key String>
    open_lnd: <Open Replacement Channel with LND API Object>
    [open_transaction]: <Channel Open Transaction Hex String>
    partner_csv_delay: <Peer CSV Delay Number>
    partner_public_key: <Node to Ask For Capacity Change Public Key Hex String>
    records: [{
      type: <Change Record Type Number String>
      value: <Change Record Value Hex Encoded String>
    }]
    remote_balance: <Peer Balance Tokens Number>
    transaction_id: <Channel Funding Transaction Id Hex String>
  }
*/
module.exports = ({ask, id, lnd, nodes}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToAskForChangeDetails']);
        }

        if (!id) {
          return cbk([400, 'ExpectedRequestIdentifierToAskForChangeDetails']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToAskForChangeDetails']);
        }

        if (!isArray(nodes)) {
          return cbk([400, 'ExpectedArrayOfPotentialMoveNodesToAskForChange']);
        }

        return cbk();
      },

      // Select peer to adjust
      askForPeer: ['validate', ({}, cbk) => {
        return ask({
          name: 'query',
          message: 'Public key or alias of peer to change capacity with?',
          type: 'input',
          validate: input => !!input,
        },
        ({query}) => cbk(null, query));
      }],

      // Get channels to use to lookup a public key for a peer
      getChannels: ['validate', ({}, cbk) => getChannels({lnd}, cbk)],

      // Get feature info for peers to figure out maximum channel size
      getFeatures: ['validate', ({}, cbk) => getPeers({lnd}, cbk)],

      // Get the chain fee rate
      getFeeRate: ['validate', ({}, cbk) => {
        return getChainFeeRate({lnd, confirmation_target: slowTarget}, cbk);
      }],

      // Find the node with the public key or alias entered
      findKey: [
        'askForPeer',
        'getChannels',
        ({askForPeer, getChannels}, cbk) =>
      {
        return findKey({
          lnd,
          channels: getChannels.channels,
          query: askForPeer,
        },
        cbk);
      }],

      // Get the alias of the peer
      getAlias: ['findKey', ({findKey}, cbk) => {
        return getNodeAlias({lnd, id: findKey.public_key}, cbk);
      }],

      // Send a test message to the selected peer to confirm they are connected
      testPeer: ['findKey', 'getChannels', ({findKey, getChannels}, cbk) => {
        const hasPeer = !!getChannels.channels.find(channel => {
          return channel.partner_public_key === findKey.public_key;
        });

        if (!hasPeer) {
          return cbk([400, 'UnknownPeerToChangeChannelCapacityWith']);
        }

        return sendMessageToPeer({
          lnd,
          message: testMessage,
          public_key: findKey.public_key,
        },
        err => {
          if (!!err) {
            return cbk([503, 'CannotCommunicateWithSelectedPeer', {err}]);
          }

          return cbk();
        });
      }],

      // Select a channel to adjust when there are multiple choices
      askForChannel: [
        'findKey',
        'getChannels',
        'testPeer',
        ({findKey, getChannels}, cbk) =>
      {
        const channelsForPeer = getChannels.channels.filter(channel => {
          return channel.partner_public_key === findKey.public_key;
        });

        const [channel, more] = channelsForPeer;

        // Exit early when there is only one channel, no need to ask
        if (!more) {
          return cbk(null, channel.id);
        }

        const choices = channelsForPeer.map(channel => {
          // Do not allow changes on inactive or coop close locked channels
          const disabled = [
            !!channel.cooperative_close_address,
            !channel.is_active,
            !!channel.pending_payments.length,
          ];

          return {
            disabled: !!disabled.filter(n => !!n).length,
            name: `${channel.id}: ${tokensAsBigUnit(channel.capacity)}`,
            value: channel.id,
          };
        });

        if (!choices.filter(n => !n.disabled).length) {
          return cbk([400, 'NoSuitableChannelsToChangeCapacity']);
        }

        return ask({
          choices,
          loop: false,
          message: 'Channel to change?',
          name: 'id',
          type: 'list',
        },
        ({id}) => cbk(null, id));
      }],

      // Get the channel policy info
      getPolicy: ['askForChannel', ({askForChannel}, cbk) => {
        return getChannel({lnd, id: askForChannel}, cbk);
      }],

      // Get chain transactions
      getTx: ['askForChannel', ({askForChannel}, cbk) => {
        return getChainTransactions({lnd}, cbk);
      }],

      // Details of the channel to change capacity with
      channel: [
        'askForChannel',
        'findKey',
        'getChannels',
        'getFeatures',
        'getFeeRate',
        'getPolicy',
        'getTx',
        ({
          askForChannel,
          findKey,
          getChannels,
          getFeatures,
          getFeeRate,
          getPolicy,
          getTx,
        },
        cbk) =>
      {
        const feeRate = getFeeRate.tokens_per_vbyte;
        const id = askForChannel;
        const peerKey = findKey.public_key;

        const channel = getChannels.channels.find(n => n.id === id);

        // Do not allow selecting channels that are in use
        if (channel.pending_payments.length) {
          return cbk([400, 'ChannelHasPendingPayments']);
        }

        const peer = getFeatures.peers.find(n => n.public_key === peerKey);

        // The peer must be connected
        if (!peer) {
          return cbk([503, 'FailedToFindConnectedPeer']);
        }

        const policy = getPolicy.policies.find(n => n.public_key === peerKey);

        // A routing policy must be known so that it can be reset later
        if (!policy || !policy.cltv_delta) {
          return cbk([503, 'CannotFindChannelRoutingPolicyDetails']);
        }

        const openTx = getTx.transactions.find(tx => {
          return tx.id === channel.transaction_id;
        });

        // A peer that disallows large channels limits the increase allowable
        const isLarge = peer.features.find(n => n.bit === largeChannelsBit);

        // When decreasing, cannot decrease more than there are fund available
        const maxDecreaseTokens = nonNegative(sumOf([
          -channel.commit_transaction_fee,
          -ceil(weightAsVBytes(weightBuffer) * feeRate),
          -ceil(weightAsVBytes(channel.commit_transaction_weight) * feeRate),
          channel.local_balance,
          -dustBuffer,
        ]));

        // When increasing, cannot increase more than the peer supports
        const maxIncrease = !!isLarge ? maxSats : maxSize - channel.capacity;

        return cbk(null, {
          base_fee_mtokens: policy.base_fee_mtokens,
          capacity: channel.capacity,
          cltv_delta: policy.cltv_delta,
          commit_transaction_fee: channel.commit_transaction_fee,
          commit_transaction_weight: channel.commit_transaction_weight,
          coop_close_address: channel.cooperative_close_address,
          fee_rate: policy.fee_rate,
          id: channel.id,
          is_private: channel.is_private,
          local_balance: channel.local_balance,
          open_transaction: !!openTx ? openTx.transaction : undefined,
          max_decrease_tokens: maxDecreaseTokens,
          max_increase_tokens: nonNegative(maxIncrease),
          partner_public_key: channel.partner_public_key,
          remote_balance: channel.remote_balance,
          remote_csv: channel.remote_csv,
          transaction_id: channel.transaction_id,
          transaction_vout: channel.transaction_vout,
        });
      }],

      // Choose whether to add or remove coins
      askForDirection: ['channel', 'getAlias', ({channel, getAlias}, cbk) => {
        const {alias} = getAlias;

        const choices = [
          {
            disabled: !channel.max_increase_tokens,
            name: `Increase capacity (currently ${channel.capacity})`,
            value: 'increase',
          },
          {
            disabled: !channel.max_decrease_tokens,
            name: `Decrease capacity (limit ${channel.max_decrease_tokens})`,
            value: 'decrease',
          },
        ];

        if (!!nodes.filter(n => n.public_key !== getAlias.id).length) {
          choices.push({
            disabled: !channel.max_decrease_tokens,
            name: `Move the channel with ${alias} to another of your nodes?`,
            value: 'migrate',
          });
        }

        return ask({
          choices,
          message: 'How do you want to change the channel capacity?',
          name: 'direction',
          type: 'list',
        },
        ({direction}) => cbk(null, direction));
      }],

      // Ask for migration
      askForMigration: [
        'askForDirection',
        'channel',
        ({askForDirection, channel}, cbk) =>
      {
        // Exit early if not decrease or no saved nodes
        if (askForDirection !== 'migrate') {
          return cbk();
        }

        const peer = channel.partner_public_key;

        const potentialNodes = nodes.filter(n => n.public_key !== peer);

        return ask({
          choices: potentialNodes.map((node, i) => ({
            name: `${node.node_name} ${node.public_key}`,
            value: i,
          })),
          message: 'Move channel to?',
          name: 'migration',
          type: 'list',
        },
        ({migration}) => cbk(null, potentialNodes[migration]));
      }],

      // Add peer from migrating node
      connect: [
        'askForMigration',
        'findKey',
        ({askForMigration, findKey}, cbk) =>
      {
        // Exit early if its there is no migration
        if (!askForMigration) {
          return cbk();
        }

        return connectPeer({
          id: findKey.public_key,
          lnd: askForMigration.lnd,
        },
        cbk);
      }],

      // Ask for how much to decrease
      askForDecrease: [
        'askForDirection',
        'channel',
        ({askForDirection, channel}, cbk) =>
      {
        // Exit early when funds are being added
        if (askForDirection !== 'decrease') {
          return cbk();
        }

        const decreases = [];
        const maximum = channel.max_decrease_tokens;

        if (!maximum) {
          return cbk([400, 'ChannelLocalBalanceTooLowToDecrease']);
        }

        return asyncUntil(
          cbk => cbk(null, !!decreases.find(n => n.is_final)),
          cbk => {
            return askForDecrease({
              ask,
              lnd,
              max: maximum - sumOf(decreases.map(n => n.tokens + outputSize)),
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              if (!!res.address && decreases.find(n => n.address === res.address)) {
                return cbk([400, 'ExpectedUniqueAddressForSpend']);
              }

              return cbk(null, decreases.push(res));
            });
          },
          err => {
            if (!!err) {
              return cbk(err);
            }

            // Only include decreases that spend funds
            return cbk(null, decreases.filter(n => !!n.tokens));
          }
        );
      }],

      // Ask to see how much to add to the channel
      askForIncrease: [
        'askForDirection',
        'channel',
        ({askForDirection, channel}, cbk) =>
      {
        // Exit early when funds are being added
        if (askForDirection !== 'increase') {
          return cbk();
        }

        const balance = channel.local_balance;

        return ask({
          name: 'amount',
          message: `Amount to add?`,
          type: 'input',
          validate: input => {
            if (!isNumber(input) || !Number.isInteger(Number(input))) {
              return false;
            }

            if (!!Number(input) && Number(input) < dust) {
              return false;
            }

            return true;
          },
        },
        ({amount}) => cbk(null, Number(amount)));
      }],

      // Confirm or change the announce status of the replacement channel
      askForPublicPrivate: [
        'askForDecrease',
        'askForIncrease',
        'askForMigration',
        'channel',
        ({channel}, cbk) =>
      {
        return ask({
          choices: ['Public', 'Private'].map(type => {
            const isPrivate = type === 'Private';

            // Exit early when the type would be different
            if (isPrivate !== channel.is_private) {
              return type;
            }

            return `${type} (keep current status)`;
          }),
          default: channel.is_private ? 'Private' : 'Public',
          message: 'Replacement channel type?',
          name: 'type',
          type: 'list',
        },
        ({type}) => cbk(null, {is_private: type === 'Private'}));
      }],

      // Estimate the chain fee
      estimateChainFee: [
        'askForDecrease',
        'askForIncrease',
        'askForPublicPrivate',
        'channel',
        'getFeeRate',
        ({askForDecrease, askForIncrease, channel, getFeeRate}, cbk) =>
      {
        const {fee} = feeForReplacement({
          capacity: channel.capacity,
          commit_transaction_fee: channel.commit_transaction_fee,
          commit_transaction_weight: channel.commit_transaction_weight,
          decrease: askForDecrease || [],
          increase: askForIncrease || undefined,
          tokens_per_vbyte: getFeeRate.tokens_per_vbyte,
        });

        return cbk(null, {fee});
      }],

      // Confirm chain fee payment estimate
      confirmFeeEstimate: [
        'askForPublicPrivate',
        'channel',
        'estimateChainFee',
        ({channel, estimateChainFee}, cbk) =>
      {
        const {fee} = estimateChainFee;

        return ask({
          type: 'confirm',
          name: 'proceed',
          message: `Pay estimated channel replacement chain-fee: ${fee}?`,
        },
        ({proceed}) => cbk(null, proceed));
      }],

      // Final capacity change details
      details: [
        'askForDecrease',
        'askForIncrease',
        'askForMigration',
        'askForPublicPrivate',
        'channel',
        'connect',
        'confirmFeeEstimate',
        'estimateChainFee',
        'getTx',
        ({
          askForDecrease,
          askForIncrease,
          askForMigration,
          askForPublicPrivate,
          channel,
          connect,
          confirmFeeEstimate,
          estimateChainFee,
          getTx,
        },
        cbk) =>
      {
        if (!confirmFeeEstimate) {
          return cbk([400, 'RejectedCapacityChangeDueToFeeEstimate']);
        }

        // Estimate how much local balance will be adjusted down
        const estimatedLocalDelta = sumOf([
          -sumOfTokens(askForDecrease || []),
          askForIncrease || Number(),
          -estimateChainFee.fee,
        ]);

        // The new capacity is the old one with decreases/increases, minus fee
        const estimatedNewCapacity = sumOf([
          channel.capacity,
          estimatedLocalDelta,
        ]);

        if (channel.local_balance + estimatedLocalDelta < minNewLocalBalance) {
          return cbk([400, 'InsufficientFundsToChangeChannelCapacity']);
        }

        // The change will be communicated in change records
        const {records} = encodeChangeRequest({
          id,
          channel: channel.id,
          decrease: !!askForDecrease ? sumOfTokens(askForDecrease) : undefined,
          increase: askForIncrease,
          to: !!askForMigration ? askForMigration.public_key : undefined,
          type: askForPublicPrivate.is_private ? privateType : publicType,
        });

        return cbk(null, {
          records,
          base_fee_mtokens: channel.base_fee_mtokens,
          cltv_delta: channel.cltv_delta,
          coop_close_address: channel.coop_close_address,
          decrease: askForDecrease || [],
          estimated_capacity: estimatedNewCapacity,
          estimated_local_delta: estimatedLocalDelta,
          fee_rate: channel.fee_rate,
          id: channel.id,
          increase: askForIncrease,
          is_private: askForPublicPrivate.is_private,
          open_from: !!askForMigration ? askForMigration.public_key : null,
          open_lnd: !!askForMigration ? askForMigration.lnd : lnd,
          open_transaction: channel.open_transaction,
          partner_csv_delay: channel.partner_csv_delay,
          partner_public_key: channel.partner_public_key,
          remote_balance: channel.remote_balance,
          transaction_id: channel.transaction_id,
        });
      }],
    },
    returnResult({reject, resolve, of: 'details'}, cbk));
  });
};
