const {createCipheriv} = require('crypto');
const {createHash} = require('crypto');

const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const {privateTypes} = require('./swap_field_types');

const algorithm = 'aes-256-gcm';
const bufferAsHex = buffer => buffer.toString('hex');
const {concat} = Buffer;
const digest = 'sha512';
const encodeNum = number => encodeBigSize({number: number.toString()}).encoded;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const makeIv = () => Buffer.alloc(16, 0);
const sha256 = n => createHash('sha256').update(n).digest();
const {typeAuthTag} = privateTypes;
const {typeCipher} = privateTypes;
const {typeCoopPrivateKey} = privateTypes;
const {typeKeyIndex} = privateTypes;
const {typeSecret} = privateTypes;
const {typeSoloPrivateKey} = privateTypes;

/** Encode secret values for swap

  {
    coop_private_key: <Cooperative Private Key Hex String>
    encrypt: <Encrypt Secrets Base Encryption Key Hex String>
    hash: <Swap Hash Hex String>
    [key_index]: <Unilateral Key Id Number>
    [secret]: <Swap Claim Secret Hex String>
    [solo_private_key]: <Unilateral Key Hex String>
  }

  @returns
  {
    encoded: <Encoded Secrets Hex String>
  }
*/
module.exports = args => {
  const iv = makeIv();

  // The key to encrypt the secrets is the encrypt key plus swap hash, hashed
  const key = sha256(hexAsBuffer(args.encrypt + args.hash));

  createCipheriv(algorithm, key, iv);

  const cipher = createCipheriv(algorithm, key, iv);


  const records = [
    {
      type: typeCoopPrivateKey,
      value: args.coop_private_key,
    },
    {
      type: typeKeyIndex,
      value: !args.solo_private_key ? encodeNum(args.key_index) : undefined,
    },
    {
      type: typeSecret,
      value: args.secret,
    },
    {
      type: typeSoloPrivateKey,
      value: args.solo_private_key,
    },
  ];

  const {encoded} = encodeTlvStream({records: records.filter(n => !!n.value)});

  const updated = [cipher.update(hexAsBuffer(encoded)), cipher.final()];

  const encrypted = [
    {
      type: typeAuthTag,
      value: bufferAsHex(cipher.getAuthTag()),
    },
    {
      type: typeCipher,
      value: bufferAsHex(concat(updated)),
    },
  ];

  return {encoded: encodeTlvStream({records: encrypted}).encoded};
};
