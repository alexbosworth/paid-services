const {encodeTlvStream} = require('bolt01');

const networkRecordFromRequest = require('./network_record_from_request');
const {requestAsRequestRecords} = require('./../records');

const asTrade = hex => `626f73ff${hex}`;

/** Encode a trade for a regular payment

  [1]: <Network Name>
  2: <Payment Request Record>

  {
    request: <BOLT 11 Payment Request String>
  }

  @returns
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({request}, cbk) => {
  // Encode the request into a trade record
  const tradeRecords = [{
    type: '2',
    value: requestAsRequestRecords({request}).encoded,
  }];

  // Add a network name record if required
  if (!!networkRecordFromRequest({request}).value) {
    tradeRecords.push({
      type: '1',
      value: networkRecordFromRequest({request}).value,
    });
  }

  return {trade: asTrade(encodeTlvStream({records: tradeRecords}).encoded)};
};
