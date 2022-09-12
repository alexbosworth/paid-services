const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const decodeSwapSecrets = require('./decode_swap_secrets');
const {publicTypes} = require('./swap_field_types');

const decodeNumber = encoded => decodeBigSize({encoded}).decoded;
const findRecord = (records, type) => records.find(n => n.type === type);
const lengthHashHex = 64;
const maxTokensNumber = 21e14;
const {typeHash} = publicTypes;
const {typePrivateClaimDetails} = publicTypes;
const {typeTokens} = publicTypes;
const {typeVersion} = publicTypes;

/** Decode an off to on recovery

  {
    decrypt: <Decrypt Key Hex String>
    recovery: <Off to On Recovery Hex String>
  }

  @throws
  <Error>

  @returns
  {
    coop_private_key: <Cooperative Private Key Hex String>
    key_index: <Claim Key Id Number>
    secret: <Swap Claim Secret Hex String>
    [solo_private_key]: <Unilateral Private Key Hex String>
    tokens: <Tokens Number>
  }
*/
module.exports = ({decrypt, recovery}) => {
  if (!decrypt) {
    throw new Error('ExpectedEncryptKeyToDecodeOffToOnRecovery');
  }

  if (!recovery) {
    throw new Error('ExpectedEncodedRecoveryToDecodeOffToOnRecovery');
  }

  try {
    decodeTlvStream({encoded: recovery});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForOffToOnRecovery');
  }

  const {records} = decodeTlvStream({encoded: recovery});

  const hashRecord = findRecord(records, typeHash);

  if (!hashRecord) {
    throw new Error('ExpectedHashRecordInOffToOnRecovery');
  }

  if (hashRecord.value.length !== lengthHashHex) {
    throw new Error('ExpectedSwapHashRecordInOffToOnRecovery');
  }

  const privateClaimDetails = findRecord(records, typePrivateClaimDetails);

  if (!privateClaimDetails) {
    throw new Error('ExpectedPrivateClaimDetailsRecordInOffToOnRecovery');
  }

  const tokensRecord = findRecord(records, typeTokens);

  if (!tokensRecord) {
    throw new Error('ExpectedTokensRecordInOffToOnRecovery');
  }

  try {
    decodeNumber(tokensRecord.value);
  } catch (err) {
    throw new Error('ExpectedValidTokensRecordInOffToOnRecovery');
  }

  if (BigInt(decodeNumber(tokensRecord.value)) > BigInt(maxTokensNumber)) {
    throw new Error('ExpectedSmallerTokensValueInOffToOnRecovery');
  }

  const versionRecord = findRecord(records, typeVersion);

  if (!!versionRecord) {
    throw new Error('UnexpectedVersionOfOffToOnRecovery');
  }

  const secrets = decodeSwapSecrets({
    decrypt,
    encoded: privateClaimDetails.value,
    hash: hashRecord.value,
  });

  return {
    coop_private_key: secrets.coop_private_key,
    key_index: secrets.key_index,
    secret: secrets.secret,
    solo_private_key: secrets.solo_private_key,
    tokens: Number(decodeNumber(tokensRecord.value)),
  };
};
