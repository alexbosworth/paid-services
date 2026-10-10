const {createHash} = require('node:crypto');

const {typeRequestSignature} = require('./constants');
const {withoutRecord} = require('./../service_records');

const bufferAsHex = buffer => buffer.toString('hex');
const sha256 = n => createHash('sha256').update(n).digest();

/** Get the key of an invoice request, which is the same for a request that
  is sent again

  The key is the hash of every record of the request other than its
  signature, so requests with any other difference have other keys.

  {
    encoded: <Invoice Request TLV Stream Hex String>
  }

  @throws
  <Error>

  @returns
  {
    key: <Request Key Hex String>
  }
*/
module.exports = ({encoded}) => {
  const unsigned = withoutRecord({encoded, type: typeRequestSignature});

  return {key: bufferAsHex(sha256(unsigned.encoded))};
};
