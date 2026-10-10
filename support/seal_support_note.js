const {createCipheriv} = require('node:crypto');
const {randomBytes} = require('node:crypto');

const {maxSupportNoteBytes} = require('./constants');
const supportNoteKey = require('./support_note_key');
const {supportNoteSaltBytes} = require('./constants');

const algorithm = 'chacha20-poly1305';
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const lengthNonceBytes = 12;
const lengthTagBytes = 16;

/** Seal a support note of at most 128 bytes of UTF-8 text to the payment
  preimage of an invoice, with a random salt

  A `salt` is only for making test vectors. A salt must never be used for
  two notes.

  {
    note: <Support Note Text String>
    preimage: <Payment Preimage Hex String>
    [salt]: <Support Note 16 Byte Salt Hex String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Sealed Support Note Hex String>
  }
*/
module.exports = ({note, preimage, salt}) => {
  if (typeof note !== 'string' || !note) {
    throw new Error('ExpectedNoteTextToSealSupportNote');
  }

  const text = Buffer.from(note, 'utf8');

  if (text.length > maxSupportNoteBytes) {
    throw new Error('ExpectedShorterNoteToSealSupportNote');
  }

  const noteSalt = salt || bufferAsHex(randomBytes(supportNoteSaltBytes));

  const {key} = supportNoteKey({preimage, salt: noteSalt});

  const cipher = createCipheriv(
    algorithm,
    Buffer.from(key, 'hex'),
    Buffer.alloc(lengthNonceBytes),
    {authTagLength: lengthTagBytes}
  );

  const sealed = Buffer.concat([
    Buffer.from(noteSalt, 'hex'),
    cipher.update(text),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {encoded: bufferAsHex(sealed)};
};
