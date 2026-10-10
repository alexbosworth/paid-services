const {createDecipheriv} = require('node:crypto');

const {lengthTagBytes} = require('./constants');

const algorithm = 'chacha20-poly1305';
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const nonce = Buffer.alloc(12);

/** Open the sealed data of a service record

  The data only opens with the key the record was sealed with, and when the
  associated data is the same as when it was sealed

  {
    associated: <Associated Data Hex String>
    key: <Record Sealing Key Hex String>
    sealed: <Sealed Data With Tag Hex String>
  }

  @throws
  <Error>

  @returns
  {
    data: <Opened Data Buffer Object>
  }
*/
module.exports = ({associated, key, sealed}) => {
  const box = hexAsBuffer(sealed);

  try {
    const decipher = createDecipheriv(algorithm, hexAsBuffer(key), nonce, {
      authTagLength: lengthTagBytes,
    });

    const cipherText = box.subarray(0, box.length - lengthTagBytes);

    decipher.setAAD(hexAsBuffer(associated), {
      plaintextLength: cipherText.length,
    });

    decipher.setAuthTag(box.subarray(box.length - lengthTagBytes));

    const opened = decipher.update(cipherText);

    return {data: Buffer.concat([opened, decipher.final()])};
  } catch (err) {
    throw new Error('ExpectedServiceRecordMadeByThisNode');
  }
};
