const {decodeTlvStream} = require('bolt01');

const decodeRecords = require('./decode_records');

const hexLength = bytes => bytes * 2;

/** Cut the bytes of one record out of a TLV stream, as it was received

  Every other record is kept exactly as it was received, including records
  that are not known, so the bytes can be checked against a signature or a
  tag. The stream is not encoded again.

  {
    encoded: <TLV Stream Hex String>
    type: <Record Type to Cut Out Number String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <TLV Stream Without the Record Hex String>
  }
*/
module.exports = ({encoded, type}) => {
  // The stream is valid, in order, and minimally encoded
  decodeRecords({encoded});

  const {records} = decodeTlvStream({encoded: encoded.toLowerCase()});

  let start = 0;

  const kept = records.map(record => {
    const bytes = encoded.slice(start, start + hexLength(record.length));

    start += hexLength(record.length);

    return record.type === type ? '' : bytes;
  });

  return {encoded: kept.join('')};
};
