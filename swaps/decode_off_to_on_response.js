const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const {requestRecordsAsRequest} = require('./../records');
const {publicTypes} = require('./swap_field_types');
const {swapVersion} = require('./swap_field_types');

const decodeNumber = encoded => decodeBigSize({encoded}).decoded;
const findRecord = (records, type) => records.find(n => n.type === type);
const isHash = n => n.length === 64;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n); 
const maxTok = BigInt(21e14);
const paymentNonceLength = 64;
const startIndex = 0;
const typeCoopPrivateKeyHash = publicTypes.typeRefundCoopPrivateKeyHash;
const {typeDeposit} = publicTypes;
const {typeInboundPeer} = publicTypes;
const {typePush} = publicTypes;
const {typeRefundCoopPublicKey} = publicTypes;
const {typeRefundSoloPublicKey} = publicTypes;
const {typeRequest} = publicTypes;
const {typeTimeout} = publicTypes;
const {typeVersion} = publicTypes;

/** Decode off to on response

  {
    network: <BitcoinJS Network Name String>
    response: <Off To On Swap Response Hex String>
  }

  @returns
  {
    coop_private_key_hash: <Refund Cooperative Private Key Hash Hex String>
    coop_public_key: <Refund Cooperative Key Hex String>
    deposit_mtokens: <Deposit Amount Millitokens Number String>
    deposit_payment: <Deposit Payment Nonce Hex String>
    [incoming_peer]: <Constrained to Inbound Peer Public Key Id Hex String>
    push: <Push Payment Nonce Hex String>
    refund_public_key: <Refund Unilateral Public Key Hex String>
    request: <BOLT 11 Encoded Funding Request String>
    timeout: <Timeout Block Height Constraint Number>
  }
*/
module.exports = ({network, response}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToDecodeOffToOnResponse');
  }

  if (!response) {
    throw new Error('ExpectedResponseToDecodeOffToOnResponse');
  }

  try {
    decodeTlvStream({encoded: response});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForOffToOnResponse');
  }

  const {records} = decodeTlvStream({encoded: response});

  if (!findRecord(records, typeVersion)) {
    throw new Error('UnexpectedVersionOfOffToOnResponse');
  }

  const versionRecord = findRecord(records, typeVersion);

  try {
    decodeNumber(versionRecord.value);
  } catch (err) {
    throw new Error('ExpectedValidVersionRecordForOffToOnResponse');
  }

  if (Number(decodeNumber(versionRecord.value)) !== swapVersion) {
    throw new Error('UnsupportedSwapVersionNumberForOffchainToOnchainSwap');
  }

  const coopPrivateKeyHashRecord = findRecord(records, typeCoopPrivateKeyHash);

  if (!coopPrivateKeyHashRecord) {
    throw new Error('ExpectedCoopPrivateKeyHashInOffToOnResponseRecord');
  }

  if (!isHash(coopPrivateKeyHashRecord.value)) {
    throw new Error('ExpectedValidPrivateKeyHashInOffToOnResponse');
  }

  const coopPublicKeyRecord = findRecord(records, typeRefundCoopPublicKey);

  if (!coopPublicKeyRecord) {
    throw new Error('ExpectedCoopPublicKeyInOffToOnResponse');
  }

  if (!isPublicKey(coopPublicKeyRecord.value)) {
    throw new Error('ExpectedValidCoopPublicKeyInOffToOnResponse');
  }

  const depositRecord = findRecord(records, typeDeposit);

  if (!depositRecord) {
    throw new Error('ExpectedDepositRecordInOffToOnResponse');
  }

  if (depositRecord.value.length <= paymentNonceLength) {
    throw new Error('ExpectedValidDepositValueInOffToOnResponse');
  }

  const depositAmount = depositRecord.value.slice(paymentNonceLength);

  if (!depositAmount) {
    throw new Error('ExpectedDepositAmountInOffToOnResponse');
  }

  try {
    decodeBigSize({encoded: depositAmount});
  } catch (err) {
    throw new Error('ExpectedValidDepositAmountInOffToOnResponse');
  }

  if (BigInt(decodeBigSize({encoded: depositAmount}).decoded) > maxTok) {
    throw new Error('ExpectedSmallerDepositAmountInOffToOnResponse');
  }

  const inboundRecord = findRecord(records, typeInboundPeer);

  if (!!inboundRecord && !isPublicKey(inboundRecord.value)) {
    throw new Error('ExpectectedPublicKeyForInboundPeerConstraint');
  }

  const pushRecord = findRecord(records, typePush);

  if (!pushRecord) {
    throw new Error('ExpectedPushRecordInOffToOnResponse');
  }

  if (!isHash(pushRecord.value)) {
    throw new Error('ExpectedPushPaymentNonceInOffToOnResponse');
  }

  if (!findRecord(records, typeRequest)) {
    throw new Error('ExpectedRequestRecordInOffToOnResponse');
  }

  const requestRecord = findRecord(records, typeRequest).value;
  const soloPublicKeyRecord = findRecord(records, typeRefundSoloPublicKey);

  if (!soloPublicKeyRecord) {
    throw new Error('ExpectedSoloPublicKeyRecordInOffToOnResponse');
  }

  if (!isPublicKey(soloPublicKeyRecord.value)) {
    throw new Error('ExpectedValidSoloPublicKeyInOffToOnResponse');
  }

  const timeoutRecord = findRecord(records, typeTimeout);

  if (!timeoutRecord) {
    throw new Error('ExpectedSwapTimeoutInOffToOnResponse');
  }

  try {
    requestRecordsAsRequest({network, encoded: requestRecord});
  } catch (err) {
    throw new Error('ExpectedValidRequestRecordInOffToOnResponse');
  }

  const funding = requestRecordsAsRequest({network, encoded: requestRecord});

  return {
    coop_private_key_hash: coopPrivateKeyHashRecord.value,
    coop_public_key: coopPublicKeyRecord.value,
    deposit_mtokens: decodeBigSize({encoded: depositAmount}).decoded,
    deposit_payment: depositRecord.value.slice(startIndex, paymentNonceLength),
    incoming_peer: !!inboundRecord ? inboundRecord.value : undefined,
    push: pushRecord.value,
    refund_public_key: soloPublicKeyRecord.value,
    request: funding.request,
    timeout: Number(decodeNumber(timeoutRecord.value)),
  };
};
