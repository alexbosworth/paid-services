const encodePeerRequest = require('./../../../p2p/encode_peer_request');
const {member} = require('./group_members');

// Decode peer request bytes
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
// Use a repeatable peer request id
const requestId = () => '00'.repeat(32);

/** Send an encoded peer request through the LND subscription

  {
    group: <Coordinator Object>
    replies: [<Decoded Peer Response Object>]
    request: {
      [from]: <Requesting Node Public Key Hex String>
      [id]: <Group Id Hex String>
      type: <Peer Request Type Number String>
    }
    subscription: <Peer Message Subscription Event Emitter Object>
  }

  @returns
  <Decoded Peer Response Object Or Undefined>
*/
module.exports = args => {
  const before = args.replies.length;

  const {message} = encodePeerRequest({
    id: requestId(),
    records: [{type: '1', value: args.request.id || args.group.id}],
    type: args.request.type,
  });

  args.subscription.emit('data', {
    data: hexAsBuffer(message),
    peer: hexAsBuffer(args.request.from || member),
    type: 32768,
  });

  const [reply] = args.replies.slice(before);

  return reply;
};
