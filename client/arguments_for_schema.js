const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const idRecord = n => ({type: '0', value: encodeBigSize({number: n}).encoded});
const idType = '0';
const encode = record => encodeTlvStream({records: [record]}).encoded;
const nameRecord = n => ({type: '1', value: Buffer.from(n).toString('hex')});
const referenceType = '0';

/** Generate encoded arguments for a service schema request

  Either a service id or name is required

  {
    [id]: <Service Id Number String>
    [named]: <Service Name String>
  }

  @throws
  <Error>

  @returns
  {
    arguments: <Hex Encoded Arguments TLV Stream String>
  }
*/
module.exports = ({id, named}) => {
  // Either a service id or name is required
  if (!id && !named) {
    throw new Error('ExpectedServiceReferenceToGenerateArgsForSchemaReq');
  }

  // Check that the id of the service can be encoded as a big size
  if (!!id) {
    try {
      encodeBigSize({number: id});
    } catch (err) {
      throw new Error('ExpectedValidNumberToEncodeSchemaIdNumber');
    }
  }

  const arguments = encode({
    type: referenceType,
    value: encode(!id ? nameRecord(named) : idRecord(id)),
  });

  return {arguments};
};
