const {decodeTlvStream} = require('bolt01');

const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);

/** Decode a TLV stream into its records, checking that it is valid

  Record types must be strictly increasing, so a type cannot be repeated.
  Lengths must be minimally encoded.

  {
    encoded: <TLV Stream Hex String>
  }

  @throws
  <Error>

  @returns
  {
    records: [{
      type: <Record Type Number String>
      value: <Record Value Hex String>
    }]
  }
*/
module.exports = ({encoded}) => {
  if (!isHex(encoded)) {
    throw new Error('ExpectedHexTlvStreamToDecodeRecords');
  }

  // Exit early when the stream cannot be decoded
  try {
    decodeTlvStream({encoded: encoded.toLowerCase()});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamToDecodeRecords');
  }

  const {records} = decodeTlvStream({encoded: encoded.toLowerCase()});

  // Types must ascend, which also means that a type cannot be repeated
  const isOrdered = records.every((record, i) => {
    return !i || BigInt(record.type) > BigInt(records[i - 1].type);
  });

  if (!isOrdered) {
    throw new Error('ExpectedAscendingRecordTypesInTlvStream');
  }

  return {records: records.map(({type, value}) => ({type, value}))};
};
