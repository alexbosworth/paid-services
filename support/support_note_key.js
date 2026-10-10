const {createHash} = require('node:crypto');

const {supportNoteSaltBytes} = require('./constants');
const {supportNoteTag} = require('./constants');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isPreimage = n => typeof n === 'string' && /^[0-9a-f]{64}$/i.test(n);
const sha256 = n => createHash('sha256').update(n).digest();

/** Get the key that seals a support note: the tagged hash of the payment
  preimage and the 16 byte salt of the note, with the tag `support-note`

  {
    preimage: <Payment Preimage Hex String>
    salt: <Support Note Salt Hex String>
  }

  @throws
  <Error>

  @returns
  {
    key: <Support Note Key Hex String>
  }
*/
module.exports = ({preimage, salt}) => {
  if (!isPreimage(preimage)) {
    throw new Error('ExpectedPaymentPreimageForSupportNoteKey');
  }

  if (!isHex(salt) || salt.length / 2 !== supportNoteSaltBytes) {
    throw new Error('ExpectedSaltForSupportNoteKey');
  }

  const tagHash = sha256(Buffer.from(supportNoteTag, 'utf8'));

  const key = sha256(Buffer.concat([
    tagHash,
    tagHash,
    hexAsBuffer(preimage),
    hexAsBuffer(salt),
  ]));

  return {key: bufferAsHex(key)};
};
