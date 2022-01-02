const {chanFormat} = require('bolt07');
const {decodeSocket} = require('bolt07');
const {decodeTlvStream} = require('bolt01');

const channelHexLength = 16;
const chunkIpV4 = data => !!data ? data.value.match(/.{1,12}/g) : [];
const chunkIpV6 = data => !!data ? data.value.match(/.{1,36}/g) : [];
const chunkTorV3 = data => !!data ? data.value.match(/.{1,74}/g) : [];

const findHighKeyChannelRecord = records => records.find(n => n.type === '1');
const findIdRecord = records => records.find(n => n.type === '2');
const findIpV4Record = records => records.find(n => n.type === '3');
const findIpV6Record = records => records.find(n => n.type === '4');
const findLowKeyChannelRecord = records => records.find(n => n.type === '0');
const findTorV3Record = records => records.find(n => n.type === '5');
const ipV4HexLength = 12;
const ipV6HexLength = 36;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const torV3HexLength = 74;

/** Decode a node record

  {
    encoded: <Encoded Node Record>
  }

  @throws
  <Error>

  @returns
  {
    [high_channel]: <High Key Channel Id String>
    [low_channel]: <Low Key Channel Id String>
    [node]: {
      id: <Node Public Key Id Hex String>
      sockets: [<Peer Socket String>]
    }
  }
*/
module.exports = ({encoded}) => {
  if (!encoded) {
    throw new Error('ExpectedEncodedNodeRecordToGetNodePointer');
  }

  const {records} = decodeTlvStream({encoded});

  const highKeyRecord = findHighKeyChannelRecord(records);

  if (!!highKeyRecord && highKeyRecord.value.length !== channelHexLength) {
    throw new Error('ExpectedChannelIdInHighKeyRecord');
  }

  if (!!highKeyRecord) {
    return {high_channel: chanFormat({id: highKeyRecord.value}).channel};
  }

  const lowKeyRecord = findLowKeyChannelRecord(records);

  if (!!lowKeyRecord && lowKeyRecord.value.length !== channelHexLength) {
    throw new Error('ExpectedChannelIdInLowKeyRecord');
  }

  if (!!lowKeyRecord) {
    return {low_channel: chanFormat({id: lowKeyRecord.value}).channel};
  }

  const idRecord = findIdRecord(records);

  if (!idRecord) {
    throw new Error('ExpectedNodeIdRecordToMapNodeRecordToNodePointer');
  }

  if (!isPublicKey(idRecord.value)) {
    throw new Error('ExpectedNodeIdPublicKeyToMapNodeRecordToNodePointer');
  }

  const ipV4SocketsRecord = findIpV4Record(records);

  if (!!ipV4SocketsRecord && !!(ipV4SocketsRecord % ipV4HexLength)) {
    throw new Error('ExpectedListOfIpV4SocketsToMapRecordToNode');
  }

  const ipV4Sockets = chunkIpV4(ipV4SocketsRecord).map(ip4 => {
    return decodeSocket({ip4}).socket;
  });

  const ipV6SocketsRecord = findIpV6Record(records);

  if (!!ipV6SocketsRecord && !!(ipV6SocketsRecord % ipV6HexLength)) {
    throw new Error('ExpectedListOfIpV6SocketsToMapRecordToNode');
  }

  const ipV6Sockets = chunkIpV6(ipV6SocketsRecord).map(ip6 => {
    return decodeSocket({ip6}).socket;
  });

  const torV3SocketsRecord = findTorV3Record(records);

  if (!!torV3SocketsRecord && !!(torV3SocketsRecord % torV3HexLength)) {
    throw new Error('ExpectedListOfTorV3SocketsToMapRecordToNode');
  }

  const torV3Sockets = chunkTorV3(torV3SocketsRecord).map(tor3 => {
    return decodeSocket({tor3}).socket;
  });

  return {
    node: {
      id: idRecord.value,
      sockets: [].concat(ipV4Sockets).concat(ipV6Sockets).concat(torV3Sockets),
    },
  };
};
