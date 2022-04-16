const {createHash} = require('crypto');

const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const decodeSwapSecrets = require('./decode_swap_secrets');
const {publicTypes} = require('./swap_field_types');

const decodeNumber = encoded => decodeBigSize({encoded}).decoded;
const findRecord = (records, type) => records.find(n => n.type === type);
const hexAsBuf = hex => Buffer.from(hex, 'hex');
const isHash = n => n.length === 64;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n); 
const maxNumber = 21e14;
const sha256 = preimage => createHash('sha256').update(preimage).digest('hex');
const {typeClaimCoopPublicKeyHash} = publicTypes;
const {typeClaimSoloPublicKey} = publicTypes;
const {typeHash} = publicTypes;
const {typePrivateRefundDetails} = publicTypes;
const {typeRefundCoopPrivateKeyHash} = publicTypes;
const {typeTimeout} = publicTypes;
const {typeTokens} = publicTypes;
const {typeVersion} = publicTypes;

/** Decode on to off recovery

  {
    decrypt: <Decrypt Key Hex String>
    recovery: <On to Off Recovery Hex String>
  }

  @returns
  {
    claim_coop_public_key_hash: <Claim Coop Public Key Hex String>
    claim_solo_public_key: <Claim Path Unilateral Public Key Hex String>
    deposit: <Deposit Invoice Id Hex String>>
    hash: <Swap Hash Hex String>
    [key_index]: <Refund Unilateral Key Id Number>
    refund_coop_private_key: <Refund Cooperative Private Key Hex String>
    refund_coop_private_key_hash: <Refund Coop Private Key Hash Hex String>
    [refund_solo_private_key]: <Refund Unilateral Private Key Hex String>
    timeout: <Timeout Block Height Constraint Number>
    tokens: <Fund Tokens Number>
  }
*/
module.exports = ({decrypt, recovery}) => {
  if (!decrypt) {
    throw new Error('ExpectedEncryptKeyToDecodeOnToOffRecovery');
  }

  if (!recovery) {
    throw new Error('ExpectedResponseToDecodeOnToOffRecovery');
  }

  try {
    decodeTlvStream({encoded: recovery});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForOnToOffRecovery');
  }

  const {records} = decodeTlvStream({encoded: recovery});

  if (!!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionOfOffToOnRecovery');
  }

  const claimCoopPubKeyHash = findRecord(records, typeClaimCoopPublicKeyHash);

  if (!claimCoopPubKeyHash) {
    throw new Error('ExpectedClaimPublicKeyHashInOffToOnRecovery');
  }

  if (!isHash(claimCoopPubKeyHash.value)) {
    throw new Error('ExpectedValidClaimCoopPublicKeyHash');
  }

  const claimSoloPublicKeyRecord = findRecord(records, typeClaimSoloPublicKey);

  if (!claimSoloPublicKeyRecord) {
    throw new Error('ExpectedClaimSoloPublicKeyRecordInOnToOffRecovery');
  }

  if (!isPublicKey(claimSoloPublicKeyRecord.value)) {
    throw new Error('ExpectedClaimSoloPublicKeyInOnToOffRecovery');
  }

  const hashRecord = findRecord(records, typeHash);

  if (!hashRecord) {
    throw new Error('ExpectedSwapHashInOnToOffRecovery');
  }

  if (!isHash(hashRecord.value)) {
    throw new Error('ExpectedValidSwapHashInOnToOffRecovery');
  }

  const privateRefundDetails = findRecord(records, typePrivateRefundDetails);

  if (!privateRefundDetails) {
    throw new Error('ExpectedPrivateRefundDetailsInOnToOffRecovery');
  }

  const timeoutRecord = findRecord(records, typeTimeout);

  if (!timeoutRecord) {
    throw new Error('ExpectedTimeoutRecordInOnToOffRecovery');
  }

  if (BigInt(decodeNumber(timeoutRecord.value)) > BigInt(maxNumber)) {
    throw new Error('ExpectedLowerTimeoutAmountInRecoveryRecord');
  }

  const tokensRecord = findRecord(records, typeTokens);

  if (!tokensRecord) {
    throw new Error('ExpectedTokensRecordInOnToOffRecovery');
  }

  if (BigInt(decodeNumber(tokensRecord.value)) > BigInt(maxNumber)) {
    throw new Error('ExpectedLowerTokensAmountInRecoveryRecord');
  }

  const secrets = decodeSwapSecrets({
    decrypt,
    encoded: privateRefundDetails.value,
    hash: hashRecord.value,
  });

  return {
    claim_coop_public_key_hash: claimCoopPubKeyHash.value,
    claim_solo_public_key: claimSoloPublicKeyRecord.value,
    hash: hashRecord.value,
    key_index: secrets.key_index,
    refund_coop_private_key: secrets.coop_private_key,
    refund_coop_private_key_hash: sha256(hexAsBuf(secrets.coop_private_key)),
    refund_solo_private_key: secrets.solo_private_key,
    timeout: Number(decodeNumber(timeoutRecord.value)),
    tokens: Number(decodeNumber(tokensRecord.value)),
  };
};
