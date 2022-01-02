const {encodeTlvStream} = require('bolt01');

const networkRecordFromRequest = require('./network_record_from_request');
const {requestAsRequestRecords} = require('./../records');

const asTrade = hex => `626f73ff${hex}`;

/** Encode a trade

  {
    auth: <Encrypted Payload Auth Hex String>
    payload: <Preimage Encrypted Payload Hex String>
    request: <BOLT 11 Payment Request String>
  }

  @returns
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({auth, payload, request}, cbk) => {
  // Encode the trade record
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

  // Encode the encrypted data
  const encryptionRecords = encodeTlvStream({
    records: [{type: '0', value: payload}, {type: '1', value: auth}],
  });

  // Encode the details of the trade
  const detailsRecords = encodeTlvStream({
    records: [{type: '0', value: encryptionRecords.encoded}],
  });

  // Add the trade details to the trade
  tradeRecords.push({type: '3', value: detailsRecords.encoded});

  return {trade: asTrade(encodeTlvStream({records: tradeRecords}).encoded)};
};
