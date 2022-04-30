const {encodeTlvStream} = require('bolt01');

const networkRecordFromNetwork = require('./network_record_from_network');
const nodeAsRecord = require('./node_as_record');

const asTrade = hex => `626f73ff${hex}`;
const typeSwap = '6';
const typeVersion = '0';
const versionRecord = '02';

/** Encode records for a swap trade request

  A swap trade request 

  0: version (v2)
  6: swap request

  {
    node: <Swap Node Identity Public Key Hex String>
    request: <Swap Request Hex String>
  }

  @throws
  <Error>

  @returns
  {
    trade: <Encoded Swap Trade Request Hex String>
  }
*/
module.exports = ({node, request}) => {
  const records = [
    {type: typeSwap, value: node + request},
    {type: typeVersion, value: versionRecord},
  ];

  return {trade: asTrade(encodeTlvStream({records}).encoded)};
};
