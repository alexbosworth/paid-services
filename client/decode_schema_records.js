const {decodeBigSize} = require('bolt01');

const decodeSchemaFields = require('./decode_schema_fields');

const decodeFields = encoded => decodeSchemaFields({encoded}).fields;
const decodeNumber = encoded => decodeBigSize({encoded}).decoded;
const findDescription = records => records.find(n => n.type === '2');
const findFields = records => records.find(n => n.type === '3');
const findId = records => records.find(n => n.type === '1');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');
const {isArray} = Array;

/** Decode schema records for a service

  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    description: <Schema Description String>
    [fields]: [{
      description: <Field Description String>
      limit: <Byte Limit Number>
      type: <Type Number String>
    }]
    [id]: <Service Id Number String>
  }
*/
module.exports = ({records}) => {
  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeSchemaRecords');
  }

  const descriptionRecord = findDescription(records);
  const fieldsRecord = findFields(records);
  const idRecord = findId(records);

  // A description is expected
  if (!descriptionRecord) {
    throw new Error('ExpectedDescriptionRecordInSchemaRecords');
  }

  // Id records must be well-formed BigSize numbers
  if (!!idRecord) {
    try {
      decodeNumber(idRecord.value);
    } catch (err) {
      throw new Error('FailedToDecodeSchemaIdRecord');
    }
  }

  // Fields record must be well-formed schema records
  if (!!fieldsRecord) {
    try {
      decodeFields(fieldsRecord.value);
    } catch (err) {
      throw new Error('FailedToDecodeSchemaFields');
    }
  }

  return {
    description: hexAsUtf8(descriptionRecord.value),
    fields: !!fieldsRecord ? decodeFields(fieldsRecord.value) : undefined,
    id: !!idRecord ? decodeNumber(idRecord.value) : undefined,
  };
};
