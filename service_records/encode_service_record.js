const {createCipheriv} = require('node:crypto');
const {randomBytes} = require('node:crypto');

const {encodeTlvStream} = require('bolt01');

const {lengthSaltBytes} = require('./constants');
const {lengthTagBytes} = require('./constants');
const {maxRecordKeyIndex} = require('./constants');
const numberAsTruncated = require('./number_as_truncated');
const {recordPrefix} = require('./constants');
const sealKeyForSalt = require('./seal_key_for_salt');
const {typeKeyIndex} = require('./constants');
const {typeSalt} = require('./constants');
const {typeSealedData} = require('./constants');
const {typeServiceType} = require('./constants');
const {typeVersion} = require('./constants');
const versionAsHex = require('./version_as_hex');

const {isSafeInteger} = Number;
const algorithm = 'chacha20-poly1305';
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const byteLength = hex => hex.length / 2;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isIndex = n => isSafeInteger(n) && n >= 0 && n <= maxRecordKeyIndex;
const isSalt = n => isHex(n) && byteLength(n) === lengthSaltBytes;
const isType = n => typeof n === 'string' && /^\d+$/.test(n);
const lengthKeyBytes = 32;
const nonce = Buffer.alloc(12);
const truncated = n => numberAsTruncated({number: String(n)}).encoded;

/** Encode a service record: the type and version of a service, and the data
  it needs, sealed with the record key at `record_key_index`

  The record can only be read or changed with the record key. A `salt` is
  only for making test vectors, a random salt is used otherwise.

  {
    data: <Service Data TLV Stream Hex String>
    key: <Record Key Hex String>
    record_key_index: <Record Key Index Number>
    [salt]: <Salt Hex String>
    type: <Service Type Number String>
    version: <Service Version Number>
  }

  @throws
  <Error>

  @returns
  {
    record: <Service Record Hex String>
  }
*/
module.exports = args => {
  if (!isHex(args.data)) {
    throw new Error('ExpectedHexServiceDataToEncodeServiceRecord');
  }

  if (!isHex(args.key) || byteLength(args.key) !== lengthKeyBytes) {
    throw new Error('ExpectedRecordKeyToEncodeServiceRecord');
  }

  if (!isIndex(args.record_key_index)) {
    throw new Error('ExpectedRecordKeyIndexToEncodeServiceRecord');
  }

  if (args.salt !== undefined && !isSalt(args.salt)) {
    throw new Error('ExpectedSaltToEncodeServiceRecord');
  }

  if (!isType(args.type)) {
    throw new Error('ExpectedServiceTypeToEncodeServiceRecord');
  }

  const salt = args.salt || bufferAsHex(randomBytes(lengthSaltBytes));

  // Every record is sealed with its own key
  const sealKey = sealKeyForSalt({salt, key: args.key}).key;

  // Every record except the sealed data is associated data
  const header = [
    {
      type: typeServiceType,
      value: numberAsTruncated({number: args.type}).encoded,
    },
    {type: typeVersion, value: versionAsHex({version: args.version}).encoded},
    {type: typeKeyIndex, value: truncated(args.record_key_index)},
    {type: typeSalt, value: salt.toLowerCase()},
  ];

  const associated = recordPrefix + encodeTlvStream({records: header}).encoded;

  const cipher = createCipheriv(algorithm, hexAsBuffer(sealKey), nonce, {
    authTagLength: lengthTagBytes,
  });

  cipher.setAAD(hexAsBuffer(associated), {
    plaintextLength: byteLength(args.data),
  });

  const sealed = Buffer.concat([
    cipher.update(hexAsBuffer(args.data)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const {encoded} = encodeTlvStream({
    records: header.concat({
      type: typeSealedData,
      value: bufferAsHex(sealed),
    }),
  });

  return {record: recordPrefix + encoded};
};
