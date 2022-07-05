const {encodeBigSize} = require('bolt01');

const typeSignedCountRecord = '1';

/** Encode signed members records

  {
    count: <Signed Count Number>
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
      type: typeSignedCountRecord,
      value: encodeBigSize({number: count}).encoded,
    }],
  };
};
