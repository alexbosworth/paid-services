const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');
const {parsePaymentRequest} = require('ln-service');

const {loopResponseTypes} = require('./swap_field_types');
const {requestRecordsAsRequest} = require('./../records');

const findRecord = (records, type) => records.find(n => n.type === type);
const hexAsBase64 = hex => Buffer.from(hex, 'hex').toString('base64');
const maxTimeout = BigInt(21e14);
const {typeDepositRequest} = loopResponseTypes;
const {typeFundRequest} = loopResponseTypes;
const {typeMacaroon} = loopResponseTypes;
const {typePreimage} = loopResponseTypes;
const {typeRemotePublicKey} = loopResponseTypes;
const {typeTimeout} = loopResponseTypes;
const {typeVersion} = loopResponseTypes;

/** Decode TLV encoded Loop response records

  {
    network: <BitcoinJs Network Name String>
    response: <TLV Encoded Lightning Loop Response Details Hex String>
  }

  @throws
  <Error>

  @returns
  {
    auth_macaroon: <Auth Macaroon Base64 String>
    auth_preimage: <Auth Preimage Hex String>
    deposit_id: <Deposit Payment Id Hex String>
    deposit_request: <Deposit Payment Request BOLT 11 String>
    deposit_tokens: <Deposit Payment Tokens Number>
    fund_id: <Funding Payment Id Hex String>
    fund_payment: <Funding Payment Nonce Hex String>
    fund_request: <Funding Payment Request BOLT 11 String>
    fund_tokens: <Funding Tokens Number>
    remote_public_key: <Service Public Key Hex String>
    timeout: <Timeout Path Height Number>
  }
*/
module.exports = ({network, response}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToDecodeLoopResponse');
  }

  if (!response) {
    throw new Error('ExpectedTlvEncodedLoopResponseToDecode');
  }

  try {
    decodeTlvStream({encoded: response});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForEncodedLoopResponse');
  }

  const {records} = decodeTlvStream({encoded: response});

  const versionRecord = findRecord(records, typeVersion);

  if (!!versionRecord) {
    throw new Error('UnsupportedVersionOfLoopResponse');
  }

  const depositRequestRecord = findRecord(records, typeDepositRequest);

  if (!depositRequestRecord) {
    throw new Error('ExpectedDepositRequestRecordInLoopResponseRecords');
  }

  try {
    requestRecordsAsRequest({network, encoded: depositRequestRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidDepositRequestRecordInLoopResponseRecords');
  }

  const deposit = requestRecordsAsRequest({
    network,
    encoded: depositRequestRecord.value,
  });

  const fundRequestRecord = findRecord(records, typeFundRequest);

  if (!fundRequestRecord) {
    throw new Error('ExpectedFundingRequestRecordInLoopResponseRecords');
  }

  try {
    requestRecordsAsRequest({network, encoded: fundRequestRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidFundRequestRecordInLoopResponseRecords');
  }

  const funding = requestRecordsAsRequest({
    network,
    encoded: fundRequestRecord.value,
  });

  const macaroonRecord = findRecord(records, typeMacaroon);

  if (!macaroonRecord) {
    throw new Error('ExpectedMacaroonInLoopResponseRecords');
  }

  const preimageRecord = findRecord(records, typePreimage);

  if (!preimageRecord) {
    throw new Error('ExpectedMacaroonPaidPreimageInLoopResponseRecords');
  }

  const remotePublicKeyRecord = findRecord(records, typeRemotePublicKey);

  if (!remotePublicKeyRecord) {
    throw new Error('ExpectedRemotePublicKeyInLoopResponseRecords');
  }

  const timeoutRecord = findRecord(records, typeTimeout);

  if (!timeoutRecord) {
    throw new Error('ExpectedTimeoutHeightInLoopResponseRecords');
  }

  try {
    decodeBigSize({encoded: timeoutRecord.value});
  } catch (err) {
    throw new Error('ExpectedValidTimeoutHeightInLoopResponseRecords');
  }

  const height = BigInt(decodeBigSize({encoded: timeoutRecord.value}).decoded);

  if (height > maxTimeout) {
    throw new Error('ExpectedLowerTimeoutHeightInLoopResponse');
  }

  const fund = parsePaymentRequest({request: funding.request});
  const prepay = parsePaymentRequest({request: deposit.request});

  return {
    auth_macaroon: hexAsBase64(macaroonRecord.value),
    auth_preimage: preimageRecord.value,
    deposit_id: prepay.id,
    deposit_request: deposit.request,
    deposit_tokens: prepay.tokens,
    fund_id: fund.id,
    fund_payment: fund.payment,
    fund_request: funding.request,
    fund_tokens: fund.tokens,
    remote_public_key: remotePublicKeyRecord.value,
    timeout: Number(height),
  };
};
