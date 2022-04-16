const {createDecipheriv} = require('crypto');
const {createHash} = require('crypto');

const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const {privateTypes} = require('./swap_field_types');
const {publicTypes} = require('./swap_field_types');

const algorithm = 'aes-256-gcm';
const {concat} = Buffer;
const decodeNumber = encoded => decodeBigSize({encoded}).decoded;
const findRecord = (records, type) => records.find(n => n.type === type);
const bufferAsHex = buffer => buffer.toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const makeIv = () => Buffer.alloc(16, 0);
const sha256 = n => createHash('sha256').update(n).digest();
const {typeAuthTag} = privateTypes;
const {typeCipher} = privateTypes;
const {typeCoopPrivateKey} = privateTypes;
const {typeKeyIndex} = privateTypes;
const {typeSecret} = privateTypes;
const {typeSoloPrivateKey} = privateTypes;
const {typeVersion} = publicTypes;

/** Decode swap secrets

  {
    decrypt: <Decrypt With Key Hex String>
    encoded: <Encoded Secrets Hex String>
    hash: <Funding Hash Hex String>
  }

  @throws
  <Error>

  @returns
  {
    coop_private_key: <Cooperative Private Key Hex String>
    [key_index]: <Unilateral Key Id Number>
    [secret]: <Swap Claim Secret Hex String>
    [solo_private_key]: <Unilateral Private Key Hex String>
  }
*/
module.exports = ({decrypt, encoded, hash}) => {
  const iv = makeIv();
  const key = sha256(hexAsBuffer(decrypt + hash));

  try {
    decodeTlvStream({encoded});
  } catch (err) {
    throw new Error('ExpectedTlvEncodedSwapSecretsValue');
  }

  const {records} = decodeTlvStream({encoded});

  if (!!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionOfSwapSecrets');
  }

  const authTagRecord = findRecord(records, typeAuthTag);

  if (!authTagRecord) {
    throw new Error('ExpectedAuthTagRecordToDecodeSwapSecrets');
  }

  const cipherRecord = findRecord(records, typeCipher);

  if (!cipherRecord) {
    throw new Error('ExpectedCipherRecordToDecodeSwapSecrets');
  }

  const decipher = createDecipheriv(algorithm, key, iv);
  const encrypted = hexAsBuffer(cipherRecord.value);

  decipher.setAuthTag(hexAsBuffer(authTagRecord.value));

  const elements = [decipher.update(encrypted), decipher.final()];

  const secrets = bufferAsHex(concat(elements));

  try {
    decodeTlvStream({encoded: secrets});
  } catch (err) {
    throw new Error('ExpectedValidSecretsTlvStreamToDecodeSecrets');
  }

  const privateRecords = decodeTlvStream({encoded: secrets}).records;

  const coopPrivateKeyRecord = findRecord(privateRecords, typeCoopPrivateKey);

  if (!coopPrivateKeyRecord) {
    throw new Error('ExpectedCoopPrivateKeyRecordToDecodeSecrets');
  }

  const keyIndexRecord = findRecord(privateRecords, typeKeyIndex) || {};
  const secretRecord = findRecord(privateRecords, typeSecret) || {};
  const soloKeyRecord = findRecord(privateRecords, typeSoloPrivateKey) || {};

  const keyIndexValue = keyIndexRecord.value;

  return {
    coop_private_key: coopPrivateKeyRecord.value,
    key_index: !!keyIndexValue ? decodeNumber(keyIndexValue) : undefined,
    secret: secretRecord.value,
    solo_private_key: soloKeyRecord.value,
  };
};
