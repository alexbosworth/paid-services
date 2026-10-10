const {createDecipheriv} = require('node:crypto');

const callOrThrow = require('./call_or_throw');
const {maxSupportNoteBytes} = require('./constants');
const supportNoteKey = require('./support_note_key');
const {supportNoteSaltBytes} = require('./constants');

const algorithm = 'chacha20-poly1305';
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const decoding = {fatal: true, ignoreBOM: true};
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const lengthNonceBytes = 12;
const lengthTagBytes = 16;

/** Open a support note with the payment preimage of its invoice

  A sealed note is a 16 byte salt, then the ciphertext, then the 16 byte tag.

  A note that is not sealed to the preimage, whose text is empty or longer
  than 128 bytes, or that is not UTF-8 text cannot be opened.

  {
    encoded: <Sealed Support Note Hex String>
    preimage: <Payment Preimage Hex String>
  }

  @throws
  <Error>

  @returns
  {
    note: <Support Note Text String>
  }
*/
module.exports = ({encoded, preimage}) => {
  if (!isHex(encoded)) {
    throw new Error('ExpectedSealedSupportNoteToOpen');
  }

  const sealed = Buffer.from(encoded, 'hex');

  if (sealed.length <= supportNoteSaltBytes + lengthTagBytes) {
    throw new Error('ExpectedLongerSealedSupportNote');
  }

  const maxBytes = supportNoteSaltBytes + maxSupportNoteBytes + lengthTagBytes;

  if (sealed.length > maxBytes) {
    throw new Error('ExpectedShorterSealedSupportNote');
  }

  const salt = bufferAsHex(sealed.subarray(0, supportNoteSaltBytes));
  const tagStart = sealed.length - lengthTagBytes;

  const {key} = supportNoteKey({preimage, salt});

  const decipher = createDecipheriv(
    algorithm,
    Buffer.from(key, 'hex'),
    Buffer.alloc(lengthNonceBytes),
    {authTagLength: lengthTagBytes}
  );

  decipher.setAuthTag(sealed.subarray(tagStart));

  const text = callOrThrow({
    error: 'ExpectedSupportNoteSealedToPaymentPreimage',
    method: () => Buffer.concat([
      decipher.update(sealed.subarray(supportNoteSaltBytes, tagStart)),
      decipher.final(),
    ]),
  });

  // A leading byte order mark is part of the note, so it is kept
  const note = callOrThrow({
    error: 'ExpectedUtf8TextInSupportNote',
    method: () => new TextDecoder('utf-8', decoding).decode(text),
  });

  return {note};
};
