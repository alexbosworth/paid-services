const {decodeBigSize} = require('bolt01');

const decodeBigSizeEncodedNumber = encoded => decodeBigSize({encoded}).decoded;

const dataRequest = 'request';
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
