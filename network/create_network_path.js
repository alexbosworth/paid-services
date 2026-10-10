const asyncAuto = require('async/auto');
const {blindedPathFromHops} = require('bolt04');
const {getIdentity} = require('ln-service');
const {getPeers} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const isHex = n => !(n.length % 2) && /^[0-9A-F]*$/i.test(n);
const isHexString = n => typeof n === 'string' && isHex(n);
const isLongPathId = n => n.length / 2 >= minPathIdBytes;
const isPublicKey = n => typeof n === 'string' && /^[0-9A-F]{66}$/i.test(n);
const minPathIdBytes = 16;

/** Create a blinded path to self that can be published to receive messages,
  starting at a connected `introduction` peer, or at self

  A given path `id` is at least 16 bytes from a secure random source, kept
  private.

  {
    [id]: <Random Path Identifier Hex String>
    [introduction]: <Introduction Connected Peer Public Key Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    id: <Path Identifier Hex String>
    path: {
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      introduction_node: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
    }
  }
*/
module.exports = ({id, introduction, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!!id && !isHexString(id)) {
          return cbk([400, 'ExpectedHexEncodedPathIdToCreateNetworkPath']);
        }

        // A path id is at least 16 random bytes, so it cannot be guessed
        if (!!id && !isLongPathId(id)) {
          return cbk([400, 'ExpectedLongerPathIdToCreateNetworkPath']);
        }

        if (!!introduction && !isPublicKey(introduction)) {
          return cbk([400, 'ExpectedIntroductionPublicKeyToCreateNetworkPath']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToCreateNetworkPath']);
        }

        return cbk();
      },

      // Get the self identity key to use as the end of the path
      getIdentity: ['validate', ({}, cbk) => getIdentity({lnd}, cbk)],

      // Get the connected peers to confirm the introduction is connected
      getPeers: ['validate', ({}, cbk) => {
        // Exit early when there is no introduction peer
        if (!introduction) {
          return cbk();
        }

        return getPeers({lnd}, cbk);
      }],

      // Check the introduction is a connected peer, and get the path nodes
      nodes: ['getIdentity', 'getPeers', ({getIdentity, getPeers}, cbk) => {
        const identity = getIdentity.public_key;

        // Exit early when the path starts and ends at self
        if (!introduction) {
          return cbk(null, {hops: [identity], introduction: identity});
        }

        // Node keys are compared in lowercase, as LND gives them
        const key = introduction.toLowerCase();

        if (key === identity) {
          return cbk([400, 'ExpectedIntroductionPeerOtherThanSelfForPath']);
        }

        const peerKeys = getPeers.peers.map(n => n.public_key);

        // The introduction node needs to be able to forward to self
        if (!peerKeys.includes(key)) {
          return cbk([503, 'ExpectedConnectedIntroductionPeerToCreatePath']);
        }

        return cbk(null, {hops: [key, identity], introduction: key});
      }],

      // Create the blinded path
      create: ['nodes', ({nodes}, cbk) => {
        try {
          const blinded = blindedPathFromHops({id, hops: nodes.hops});

          return cbk(null, {
            id: blinded.id,
            path: {
              hops: blinded.path,
              introduction_node: nodes.introduction,
              key: blinded.key,
            },
          });
        } catch (err) {
          return cbk([400, 'FailedToCreateNetworkPath', {err}]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'create'}, cbk));
  });
};
