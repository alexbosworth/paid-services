const {decodeChanId} = require('bolt07');
const {encodeSocket} = require('bolt07');
const {encodeTlvStream} = require('bolt01');
const {rawChanId} = require('bolt07');

const highOrderKeyType = '1';
const ipV4SocketsType = '3';
const ipV6SocketsType = '4';
const torV3SocketsType = '5';
const {isArray} = Array;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const join = arr => arr.join('');
const lowOrderKeyType = '0';
const nodeIdType = '2';

/** Convert node details to a node record

  A node record looks like:

  [0]: low order key channel id
  [1]: high order key channel id
  [2]: node identity public key
  [3]: node ipv4 sockets (6 byte chunks)
  [4]: node ipv6 sockets (18 byte chunks)
  [5]: node torV3 addresses (37 byte chunks)

  {
    channels: [{
      id: <Standard Format Channel Id String>
      partner_public_key: <Node Public Key Hex String>
    }]
    id: <Node Public Key Id Hex String>
    sockets: [<Peer Socket String>]
  }

  @returns
  {
    encoded: <Encoded Node Details Hex String>
  }
*/
module.exports = ({channels, id, sockets}) => {
  if (!isArray(channels)) {
    throw new Error('ExpectedArrayOfChannelsToMapNodeToRecord');
  }

  if (!isPublicKey(id)) {
    throw new Error('ExpectedNodePublicKeyToMapNodeToRecord');
  }

  if (!isArray(sockets)) {
    throw new Error('ExpectedArrayOfSocketsToMapNodeToRecord');
  }

  // Sort the channels by their height ascending, use the oldest as a landmark
  const [channel] = channels.slice().sort((a, b) => {
    const aHeight = decodeChanId({channel: a.id}).block_height;
    const bHeight = decodeChanId({channel: b.id}).block_height;

    return aHeight - bHeight;
  });

  // Exit early when there is a channel to reference
  if (!!channel) {
    const value = rawChanId({channel: channel.id}).id;

    // Sort the keys by lexicographical order
    const [key1, key2] = [channel.partner_public_key, id].sort();

    // When the id is the first key in order, it is a low record
    const type = key1 === id ? lowOrderKeyType : highOrderKeyType;

    return encodeTlvStream({records: [{type, value}]});
  }

  // When there is no channel to reference, use the node identity key instead
  const records = [{type: nodeIdType, value: id}];

  const encodedSockets = sockets.map(socket => encodeSocket({socket}));

  const ipV4 = join(encodedSockets.filter(n => !!n.ip4).map(n => n.ip4));
  const ipV6 = join(encodedSockets.filter(n => !!n.ip6).map(n => n.ip6));
  const torV3 = join(encodedSockets.filter(n => !!n.tor3).map(n => n.tor3));

  if (!!ipV4) {
    records.push({type: ipV4SocketsType, value: ipV4});
  }

  if (!!ipV6) {
    records.push({type: ipV6SocketsType, value: ipV6});
  }

  if (!!torV3) {
    records.push({type: torV3SocketsType, value: torV3});
  }

  // Return the node identity key and network sockets
  return encodeTlvStream({records});
};
