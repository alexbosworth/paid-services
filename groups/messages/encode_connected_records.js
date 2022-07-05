const {encodeBigSize} = require('bolt01');

const typeConnectedCountRecord = '1';

/** Encode connected members records

  {
    count: <Connection Count Number>
  }

  @returns
  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }
*/
module.exports = ({count}) => {
  return {
    records: [{
      type: typeConnectedCountRecord,
      value: encodeBigSize({number: count}).encoded,
    }],
  };
};
