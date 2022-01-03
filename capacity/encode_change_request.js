const {encodeBigSize} = require('bolt01');
const {rawChanId} = require('bolt07');

const channelFlagsType = '5';
const channelIdRecordType = '2';
const decreaseRecordType = '3';
const increaseRecordType = '4';
const requestIdRecordType = '1';
const typeAsHex = type => Buffer.from([type]).toString('hex');

/** Encode a request to change a channel capacity

  {
    channel: <Channel to Change Standard Format Id String>
    [decrease]: <Remove Channel Funds By Tokens Number>
    id: <Request Id Hex String>
    increase: <Add Channel Funds By Tokens Number>
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
module.exports = ({channel, decrease, id, increase, type}) => {
  const records = [
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

  if (!!decrease) {
    // Add a record reflecting the decrease in the capacity
    records.push({
      type: decreaseRecordType,
      value: encodeBigSize({number: decrease.toString()}).encoded,
    });
  }

  if (!!increase) {
    // Add a record reflecting the increase in the capacity
    records.push({
      type: increaseRecordType,
      value: encodeBigSize({number: increase.toString()}).encoded,
    });
  }

  return {records};
};
