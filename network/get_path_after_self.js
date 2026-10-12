const asyncAuto = require('async/auto');
const {decryptBlindedPath} = require('bolt04');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getChannel} = require('ln-service');
const {getChannels} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {knownHopRecordTypes} = require('./constants');
const {typePathId} = require('./constants');

const hasPathId = records => records.some(n => n.type === typePathId);
const hopsAfterFirst = hops => hops.slice(1);
const idsOf = channel => [channel.id].concat(channel.other_ids);
const {isArray} = Array;
const isEven = type => !(BigInt(type) % BigInt(2));
const isKnown = record => knownHopRecordTypes.includes(record.type);
const isPublicKey = n => typeof n === 'string' && /^[0-9A-F]{66}$/i.test(n);
const isUnknownEven = record => !isKnown(record) && isEven(record.type);

/** Get the blinded path after self, for a blinded path that starts at self

  Self reads its own hop as an introduction node would. The path goes on from
  the next node, which the hop names, or which is the peer at the other end
  of the channel that the hop names.

  As BOLT 4 asks of a node that forwards, the hop of self is not used when it
  has an unknown even record, when it has a path id, or when it allows
  features, since no onion message features are defined.

  {
    hops: [{
      encrypted_data: <Encrypted Recipient Data Hex String>
      relay_key: <Blinded Relaying Node Public Key Hex String>
    }]
    identity: <Node Identity Public Key Hex String>
    key: <First Hop Path Key Public Key Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    hops: [{
      encrypted_data: <Encrypted Recipient Data Hex String>
      relay_key: <Blinded Relaying Node Public Key Hex String>
    }]
    introduction_node: <Next Node Public Key Hex String>
    key: <Next Hop Path Key Public Key Hex String>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!isArray(args.hops) || !args.hops.length) {
          return cbk([400, 'ExpectedBlindedPathHopsToGetPathAfterSelf']);
        }

        if (!isPublicKey(args.identity)) {
          return cbk([400, 'ExpectedIdentityPublicKeyToGetPathAfterSelf']);
        }

        if (!args.key) {
          return cbk([400, 'ExpectedPathKeyToGetPathAfterSelf']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetPathAfterSelf']);
        }

        return cbk();
      },

      // Compute the shared secret of the path key and the node identity key
      getSecret: ['validate', ({}, cbk) => {
        return diffieHellmanComputeSecret({
          lnd: args.lnd,
          partner_public_key: args.key,
        },
        cbk);
      }],

      // Decrypt the data of the hop of self to read where the path goes next
      decrypt: ['getSecret', ({getSecret}, cbk) => {
        const [own] = args.hops;

        try {
          return cbk(null, decryptBlindedPath({
            encrypted: own.encrypted_data,
            key: args.key,
            secret: getSecret.secret,
          }));
        } catch (err) {
          return cbk([503, 'FailedToDecryptOwnBlindedPathHop', {err}]);
        }
      }],

      // Check the hop of self can be followed, as a forwarding node would
      check: ['decrypt', ({decrypt}, cbk) => {
        // An unknown even record cannot be ignored, so the hop cannot be used
        if (decrypt.records.some(isUnknownEven)) {
          return cbk([
            400,
            'UnexpectedUnknownRequiredRecordInOwnBlindedPathHop',
          ]);
        }

        // No features are defined for onion messages, so a feature bit in
        // the allowed features is an unknown feature, and the hop is not used
        if (!!decrypt.features.length) {
          return cbk([400, 'UnsupportedFeatureInOwnBlindedPathHop']);
        }

        // A hop with no next node or channel is the final hop of the path
        if (!decrypt.next_node_id && !decrypt.next_channel_id) {
          return cbk([400, 'UnexpectedBlindedPathToSelf']);
        }

        // A hop that goes on to a next node is not one with a path id record,
        // which is present even when the path id is empty
        if (hasPathId(decrypt.records)) {
          return cbk([400, 'UnexpectedPathIdInOwnBlindedPathHop']);
        }

        return cbk();
      }],

      // The hops after self, which the path goes on over
      hops: ['check', ({}, cbk) => {
        const hops = hopsAfterFirst(args.hops);

        // The next node has a hop of its own to send to
        if (!hops.length) {
          return cbk([400, 'ExpectedHopsAfterSelfInBlindedPath']);
        }

        return cbk(null, hops);
      }],

      // Get the channels of self when the next node is named by a channel
      getChannels: ['decrypt', 'hops', ({decrypt}, cbk) => {
        // Exit early when the hop names the next node
        if (!!decrypt.next_node_id) {
          return cbk();
        }

        return getChannels({lnd: args.lnd}, cbk);
      }],

      // Find the next channel among the channels of self
      channel: ['decrypt', 'getChannels', ({decrypt, getChannels}, cbk) => {
        // Exit early when the hop names the next node
        if (!getChannels) {
          return cbk();
        }

        const id = decrypt.next_channel_id;

        // A private channel can be named by one of its aliases
        return cbk(null, getChannels.channels.find(n => idsOf(n).includes(id)));
      }],

      // Look for the next channel in the graph when self does not list it
      getChannel: ['channel', 'decrypt', ({channel, decrypt}, cbk) => {
        // Exit early when the next node is already known
        if (!!decrypt.next_node_id || !!channel) {
          return cbk();
        }

        return getChannel({
          id: decrypt.next_channel_id,
          lnd: args.lnd,
        },
        (err, res) => {
          // Exit early when the channel is not in the graph
          if (!!err) {
            return cbk([503, 'FailedToFindNextPeerInBlindedPath']);
          }

          return cbk(null, res);
        });
      }],

      // The next node is the one that the hop names, or is across the channel
      next: [
        'channel',
        'decrypt',
        'getChannel',
        ({channel, decrypt, getChannel}, cbk) =>
      {
        // Exit early when the hop names the next node
        if (!!decrypt.next_node_id) {
          return cbk(null, decrypt.next_node_id);
        }

        // Exit early when the channel is a channel of self
        if (!!channel) {
          return cbk(null, channel.partner_public_key);
        }

        const keys = getChannel.policies.map(n => n.public_key);

        // The channel in the graph has to be one that self forwards over
        if (!keys.includes(args.identity)) {
          return cbk([503, 'FailedToFindNextPeerInBlindedPath']);
        }

        return cbk(null, keys.find(n => n !== args.identity));
      }],

      // The path goes on from the next node, with the next hop path key
      path: ['decrypt', 'hops', 'next', ({decrypt, hops, next}, cbk) => {
        return cbk(null, {
          hops,
          introduction_node: next,
          key: decrypt.next_path_key,
        });
      }],
    },
    returnResult({reject, resolve, of: 'path'}, cbk));
  });
};
