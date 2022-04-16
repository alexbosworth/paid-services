const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const {publicTypes} = require('./swap_field_types');

const decodeNumber = encoded => decodeBigSize({encoded}).decoded;
const findRecord = (records, type) => records.find(n => n.type === type);
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const lengthHashHex = 64;
const maxTokens = 21e14;
const {typeClaimCoopPublicKeyHash} = publicTypes;
const {typeClaimSoloPublicKey} = publicTypes;
const {typeHash} = publicTypes;
const {typeTokens} = publicTypes;
const {typeVersion} = publicTypes;

/** Decode a serialized off to on swap request

  {
    request: <Serialized Request Hex String>
  }

  @throws
  <Error>

  @returns
  {
    coop_public_key_hash: <Claim Cooperative Key Hash Hex String>
    hash: <Swap Claim Hash Hex String>
    solo_public_key: <Claim Unilateral Public Key Hex String>
    tokens: <Tokens Number>
  }
*/
module.exports = ({request}) => {
  if (!request) {
    throw new Error('ExpectedRequestToDecodeOffToOnSwapRequest');
  }

  try {
    decodeTlvStream({encoded: request});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForOffToOnRequest');
  }

  const {records} = decodeTlvStream({encoded: request});

  if (!!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionOfOffToOnRequest');
  }

  const coopPublicKeyHash = findRecord(records, typeClaimCoopPublicKeyHash);

  if (!coopPublicKeyHash) {
    throw new Error('ExpectedCoopPublicKeyHashInOffToOnRequest');
  }

  if (coopPublicKeyHash.value.length !== lengthHashHex) {
    throw new Error('ExpectedValidCoopPublicKeyHashInOffToOnRequest');
  }

  const hashRecord = findRecord(records, typeHash);

  if (!hashRecord) {
    throw new Error('ExpectedSwapHashInOffToOnRequest');
  }

  if (hashRecord.value.length !== lengthHashHex) {
    throw new Error('ExpectedValidSwapHashInOffToOnRequest');
  }

  const soloPublicKey = findRecord(records, typeClaimSoloPublicKey);

  if (!soloPublicKey) {
    throw new Error('ExpectedUnilateralPublicKeyForOffToOnRequest');
  }

  if (!isPublicKey(soloPublicKey.value)) {
    throw new Error('ExpectedValidPublicKeyInOffToOnRequest');
  }

  const tokensRecord = findRecord(records, typeTokens);

  try {
    decodeNumber(tokensRecord.value);
  } catch (err) {
    throw new Error('ExpectedValidTokensNumberInOffToOnRequest');
  }

  if (BigInt(decodeNumber(tokensRecord.value)) > BigInt(maxTokens)) {
    throw new Error('ExpectedLowerTokensAmountInRequestRecord');
  }

  return {
    coop_public_key_hash: coopPublicKeyHash.value,
    hash: hashRecord.value,
    solo_public_key: soloPublicKey.value,
    tokens: Number(decodeNumber(tokensRecord.value)),
  };
};
