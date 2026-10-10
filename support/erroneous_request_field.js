const fields = require('./erroneous_request_fields');

const {hasOwn} = Object;

/** Determine the invoice request field that an invoice request error is about

  Fields are BOLT 12 record types of the offer, the invoice request, or its
  signature. An error that is not about one record, like an error about an
  unknown record or about records that go together, has no field.

  {
    message: <Invoice Request Parsing Error Message String>
  }

  @returns
  {
    [erroneous_field]: <Erroneous Record Type Number String>
  }
*/
module.exports = ({message}) => {
  // Only a known error message is about a field
  if (typeof message !== 'string' || !hasOwn(fields, message)) {
    return {erroneous_field: undefined};
  }

  return {erroneous_field: fields[message]};
};
