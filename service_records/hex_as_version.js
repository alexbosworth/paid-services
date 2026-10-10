const truncatedAsNumber = require('./truncated_as_number');

const {isSafeInteger} = Number;

/** Decode a service version from a tu64 number

  {
    encoded: <Encoded Version Hex String>
  }

  @throws
  <Error>

  @returns
  {
    version: <Service Version Number>
  }
*/
module.exports = ({encoded}) => {
  const {number} = truncatedAsNumber({encoded: encoded || String()});

  if (!isSafeInteger(Number(number))) {
    throw new Error('ExpectedSafeNumberServiceVersion');
  }

  return {version: Number(number)};
};
