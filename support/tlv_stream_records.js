const {decodeRecords} = require('./../service_records');

/** Decode the records of a TLV stream, when it is a valid TLV stream

  A stream that cannot be decoded has no records, so that a caller can tell
  it apart from a valid stream without any records.

  {
    encoded: <TLV Stream Hex String>
  }

  @returns
  {
    [records]: [{
      type: <Record Type Number String>
      value: <Record Value Hex String>
    }]
  }
*/
module.exports = ({encoded}) => {
  try {
    return {records: decodeRecords({encoded}).records};
  } catch (err) {
    return {};
  }
};
