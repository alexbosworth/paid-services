const {truncatedAsNumber} = require('./../service_records');

const {isSafeInteger} = Number;

/** Decode a tu64 record value as a safe number

  {
    encoded: <Truncated Number Hex String>
    error: <Error Message When Not a Safe Number String>
  }

  @throws
  <Error>

  @returns
  {
    number: <Number>
  }
*/
module.exports = ({encoded, error}) => {
  const number = Number(truncatedAsNumber({encoded}).number);

  if (!isSafeInteger(number)) {
    throw new Error(error);
  }

  return {number};
};
