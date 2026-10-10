const {randomInt} = require('node:crypto');

const onionMessagesBits = [38, 39];

/** Select a connected peer to start a reply path at

  The peer has to relay onion messages, and is not the start of the path that
  the request is sent over. A random peer is selected from those that can be
  used, and there is no peer when none can be used.

  {
    path: {
      [introduction_node]: <Request Path Introduction Public Key Hex String>
    }
    peers: [{
      features: [{
        bit: <BOLT 09 Feature Bit Number>
      }]
      public_key: <Peer Public Key Hex String>
    }]
  }

  @returns
  {
    [introduction]: <Reply Path Introduction Peer Public Key Hex String>
  }
*/
module.exports = ({path, peers}) => {
  const relays = peers.filter(peer => {
    // The start of the request path is not used for the reply path
    if (peer.public_key === path.introduction_node) {
      return false;
    }

    return !!peer.features.find(n => onionMessagesBits.includes(n.bit));
  });

  // Exit early when there is no peer to start the reply path at
  if (!relays.length) {
    return {};
  }

  return {introduction: relays[randomInt(relays.length)].public_key};
};
