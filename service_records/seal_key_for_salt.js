const {createHmac} = require('node:crypto');

const {lengthSaltBytes} = require('./constants');

const byteLength = hex => hex.length / 2;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const lengthKeyBytes = 32;

/** Derive the key that seals one service record

  Every record has its own random salt, so every record is sealed with its
  own key. A key is only used once, so the nonce can always be zero: a key
  and nonce pair is never used twice.

  {
    key: <Record Key Hex String>
    salt: <Record Salt Hex String>
  }

  @throws
  <Error>

  @returns
  {
    key: <Record Sealing Key Hex String>
  }
*/
module.exports = ({key, salt}) => {
  if (!isHex(key) || byteLength(key) !== lengthKeyBytes) {
    throw new Error('ExpectedRecordKeyToDeriveSealKey');
  }

  if (!isHex(salt) || byteLength(salt) !== lengthSaltBytes) {
    throw new Error('ExpectedRecordSaltToDeriveSealKey');
  }

  const hmac = createHmac('sha256', hexAsBuffer(key));

  return {key: hmac.update(hexAsBuffer(salt)).digest('hex')};
};
