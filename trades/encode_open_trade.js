const {encodeTlvStream} = require('bolt01');

const networkRecordFromNetwork = require('./network_record_from_network');
const nodeAsRecord = require('./node_as_record');

const asTrade = hex => `626f73ff${hex}`;
const idType = '5';
const {isArray} = Array;
const networkRecordType = '1';
const nodeType = '4';
const versionRecord = '01';
const versionType = '0';

/** Encode records for an open ended trade

  An open ended trade is a pointer to a node or nodes that can create trade
  invoices. At the minimum it has a pointer to a node.

  0: version (v1)
  [1]: network name
  4: nodes records
  [5]: trade identifier

  {
    [id]: <Trade Identifier Hex String>
    network: <Network Name String>
    nodes: [{
      channels: [{
        id: <Standard Format Channel Id String>
        partner_public_key: <Node Public Key Hex String>
      }]
      id: <Node Public Key Id Hex String>
      sockets: [<Peer Socket String>]
    }]
  }

  @throws
  <Error>

  @returns
  {
    trade: <Encoded Open Ended Trade Hex String>
  }
*/
module.exports = ({id, network, nodes}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToEncodeOpenTrade');
  }

  if (!isArray(nodes)) {
    throw new Error('ExpectedArrayOfNodesToEncodeOpenTrade');
  }

  if (!nodes.length) {
    throw new Error('ExpectedNodeToReferToInOpenTrade');
  }

  // Add trade version record
  const records = [{type: versionType, value: versionRecord}];

  // Add a network name record if required
  if (!!networkRecordFromNetwork({network}).value) {
    records.push({
      type: networkRecordType,
      value: networkRecordFromNetwork({network}).value,
    });
  }

  // A trade id refers to a specific trade
  if (!!id) {
    records.push({type: idType, value: id});
  }

  // Map the nodes to node records
  const nodeRecords = nodes.map(({channels, id, sockets}, type) => {
    return {
      type: type.toString(),
      value: nodeAsRecord({channels, id, sockets}).encoded,
    };
  });

  // Add the node records to the open trade
  records.push({
    type: nodeType,
    value: encodeTlvStream({records: nodeRecords}).encoded,
  });

  return {trade: asTrade(encodeTlvStream({records}).encoded)};
};
