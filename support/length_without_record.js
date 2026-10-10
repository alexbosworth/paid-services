const {withoutRecord} = require('./../service_records');

const byteLength = hex => hex.length / 2;

/** Get the byte length of a TLV stream without one of its records

  A stream that cannot be read has its own length.

  {
    encoded: <TLV Stream Hex String>
    type: <Record Type Number String>
  }

  @returns
  {
    bytes: <Byte Length Without the Record Number>
  }
*/
module.exports = ({encoded, type}) => {
  try {
    return {bytes: byteLength(withoutRecord({encoded, type}).encoded)};
  } catch (err) {
    return {bytes: byteLength(encoded)};
  }
};
