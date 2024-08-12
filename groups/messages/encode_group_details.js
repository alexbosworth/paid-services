const {encodeBigSize} = require('bolt01');

const encodeNumber = number => encodeBigSize({number}).encoded;
const typeCapacity = '1';
const typeCount = '2';
const typeRate = '3';
const typeVersion = '0';
const version = '2';

/** Encode group details records

  {
    capacity: <Channel Capacity Tokens Number>
    count: <Target Members Count Number>
    rate: <Chain Fee Rate Number>
  }

  @returns
  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }
*/
module.exports = ({capacity, count, rate}) => {
  return {
    records: [
      {type: typeCapacity, value: encodeNumber(capacity)},
      {type: typeCount, value: encodeNumber(count)},
      {type: typeRate, value: encodeNumber(rate)},
      {type: typeVersion, value: encodeNumber(version)},
    ],
  };
};
