const {encodeBigSize} = require('bolt01');
const {encodeTlvRecord} = require('bolt01');
const {rawChanId} = require('bolt07');

const channelFlagsType = '5';
const channelIdRecordType = '2';
const currentVersion = '1';
const decreaseRecordType = '3';
const increaseRecordType = '4';
const migrateRecordType = '6';
const requestIdRecordType = '1';
const typeAsHex = type => Buffer.from([type]).toString('hex');
const versionRecordType = '0';

/** Encode a request to change a channel capacity

  {
    channel: <Channel to Change Standard Format Id String>
    [decrease]: <Remove Channel Funds By Tokens Number>
    id: <Request Id Hex String>
    increase: <Add Channel Funds By Tokens Number>
    [to]: <Move Channel to Different Node with Public Key Hex String>
    type: <New Channel Type Number>
  }

  @returns
  {
    records: [{
      type: <Record Type Number String>
      value: <Record Value Hex Encoded String>
    }]
  }
*/
module.exports = ({channel, decrease, id, increase, to, type}) => {
  const records = [
    {
      type: versionRecordType,
      value: encodeBigSize({number: currentVersion}).encoded,
    },
    {
      type: requestIdRecordType,
      value: id,
    },
    {
      type: channelIdRecordType,
      value: rawChanId({channel}).id,
    },
    {
      type: channelFlagsType,
      value: typeAsHex(type),
    },
  ];

  // Add a record reflecting the decrease in the capacity
  if (!!decrease) {
    records.push({
      type: decreaseRecordType,
      value: encodeBigSize({number: decrease.toString()}).encoded,
    });
  }

  // Add a record reflecting the increase in the capacity
  if (!!increase) {
    records.push({
      type: increaseRecordType,
      value: encodeBigSize({number: increase.toString()}).encoded,
    });
  }

  // Add a record reflecting the migration of channel to a different peer
  if (!!to) {
    records.push({type: migrateRecordType, value: to});
  }

  return {records};
};
