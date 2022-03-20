const {decodeTlvStream} = require('bolt01');

const recordAsNode = require('./record_as_node');

const findIdRecord = records => records.find(n => n.type === '5');
const findNodesRecord = records => records.find(n => n.type === '4');
const {isArray} = Array;

/** Decode open trade records

  An open ended trade is a pointer to a node or nodes that can create trade
  invoices.

  4: <Nodes Records>
  [5]: <Trade Identifier>

  {
    network: <Network Name String>
    records: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    [id]: <Trade Identifier Hex String>
    network: <Network Name String>
    nodes: [{
      [high_channel]: <High Key Channel Id String>
      [low_channel]: <Low Key Channel Id String>
      [node]: {
        id: <Node Public Key Id Hex String>
        sockets: [<Peer Socket String>]
      }
    }]
  }
*/
module.exports = ({network, records}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToDecodeOpenTrade');
  }

  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeOpenTrade');
  }

  const idRecord = findIdRecord(records);
  const nodesRecord = findNodesRecord(records);

  if (!nodesRecord) {
    throw new Error('ExpectedNodesRecordToDecodeOpenTradeDetails');
  }

  try {
    decodeTlvStream({encoded: nodesRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidNodesTlvStreamToDecodeOpenTradeDetails');
  }

  const nodeRecords = decodeTlvStream({encoded: nodesRecord.value}).records;

  if (!nodeRecords.length) {
    throw new Error('ExpectedNodeRecordsForOpenTrade');
  }

  return {
    network,
    id: !!idRecord ? idRecord.value : undefined,
    nodes: nodeRecords.map(({value}) => recordAsNode({encoded: value})),
  };
};
