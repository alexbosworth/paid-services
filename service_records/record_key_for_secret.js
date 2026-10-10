const {createHmac} = require('node:crypto');

const {recordKeyTag} = require('./constants');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);

/** Derive the key that seals service records from the record secret, the
  shared secret of the record key of the node and the record point

  {
    secret: <Record Secret Hex String>
  }

  @throws
  <Error>

  @returns
  {
    key: <Record Key Hex String>
  }
*/
module.exports = ({secret}) => {
  if (!isHex(secret)) {
    throw new Error('ExpectedRecordSecretToDeriveRecordKey');
  }

  const key = createHmac('sha256', hexAsBuffer(secret))
    .update(Buffer.from(recordKeyTag, 'utf8'))
    .digest('hex');

  return {key};
};
