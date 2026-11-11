const {decodeBigSize} = require('bolt01');

const dataRequest = 'request';
const decodeBigSizeEncodedNumber = encoded => decodeBigSize({encoded}).decoded;
const typeRequest = '1';

/** Decode data type

  {
    [encoded]: <Encoded Data Type Big Number Hex String>
  }

  @throws
  <Error>

  @returns
  {
    [data]: <Data Type String>
  }
*/
module.exports = ({encoded}) => {
  // Exit early when there is no data type
  if (!encoded) {
    return {};
  }

  try {
    decodeBigSizeEncodedNumber(encoded);
  } catch (err) {
    throw new Error('ExpectedValidDataTypeEncoding');
  }

  switch (decodeBigSizeEncodedNumber(encoded)) {
  case typeRequest:
    return {data: dataRequest};

  default:
    return {};
  }
};
