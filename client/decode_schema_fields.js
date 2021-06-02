const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const decodeNumber = n => decodeBigSize({encoded: n.value}).decoded;
const findDescription = records => records.find(n => n.type === '0');
const findByteLimit = records => records.find(n => n.type === '1');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');

/** Decode encoded schema field records

  These records are returned in the schema records to indicate service required
  and optional arguments.

  Encoded is a TLV stream:
  <Type>: {
    0: <Description UTF8 String>
    1: <BigSize Byte Limit Number>
  }

  {
    encoded: <Encoded Schema Fields Hex String>
  }

  @throws
  <Error>

  @returns
  {
    fields: [{
      description: <Field Description String>
      limit: <Byte Limit Number>
      type: <Type Number String>
    }]
  }
*/
module.exports = ({encoded}) => {
  if (!encoded) {
    throw new Error('ExpectedTlvStreamEncodedFieldMetadataToDecodeFields');
  }

  const {records} = decodeTlvStream({encoded});

  const fields = records.map(({type, value}) => {
    const meta = decodeTlvStream({encoded: value}).records;

    const descriptionRecord = findDescription(meta);

    if (!descriptionRecord) {
      throw new Error('ExpectedFieldDescriptionInSchemaFields');
    }

    const limitRecord = findByteLimit(meta);

    if (!!limitRecord) {
      try {
        decodeNumber(limitRecord);
      } catch (err) {
        throw new Error('ExpectedValidBigSizeEncodedNumberForSchemaByteLimit');
      }
    }

    return {
      type,
      description: hexAsUtf8(descriptionRecord.value),
      limit: !!limitRecord ? Number(decodeNumber(limitRecord)) : undefined,
    };
  });

  return {fields};
};
