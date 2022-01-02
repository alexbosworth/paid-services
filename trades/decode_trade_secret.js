const {decodeTlvStream} = require('bolt01');

const {requestRecordsAsRequest} = require('./../records');

const findAuth = records => records.find(n => n.type === '1');
const findCipher = records => records.find(n => n.type === '0');
const findDetails = records => records.find(n => n.type === '3');
const findEncrypt = records => records.find(n => n.type === '0');
const findRequest = records => records.find(n => n.type === '2');
const {isArray} = Array;

/** Decode a trade secret

  2: <Payment Request Record>
  3: <Trade Details Record

  {
    network: <Network Name String>
    records: [{
      type: <Type Number String>
      value: <Hex Encoded Value String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    auth: <Encrypted Payload Auth Hex String>
    payload: <Preimage Encrypted Payload Hex String>
    request: <BOLT 11 Payment Request String>
  }
*/
module.exports = ({network, records}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToDecodeTradeSecret');
  }

  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeTradeSecret');
  }

  // Get the payment request record
  const requestRecord = findRequest(records);

  if (!requestRecord) {
    throw new Error('ExpectedRequestRecordInTradeData');
  }

  const encoded = requestRecord.value;

  // Get the trade details
  const detailsRecord = findDetails(records);

  if (!detailsRecord) {
    throw new Error('ExpctedDetailsRecordToDecodeTrade');
  }

  // Trade details
  const details = decodeTlvStream({encoded: detailsRecord.value}).records;

  // Encode the encrypted data
  const encryptedRecord = findEncrypt(details);

  if (!encryptedRecord) {
    throw new Error('ExpectedEncryptedRecordToDecodeTrade');
  }

  const encrypted = decodeTlvStream({encoded: encryptedRecord.value}).records;

  const encryptedDataRecord = findCipher(encrypted);

  if (!encryptedDataRecord) {
    throw new Error('ExpectedEncryptedDataRecordToDecodeTrade');
  }

  const authDataRecord = findAuth(encrypted);

  if (!authDataRecord) {
    throw new Error('ExpectedAuthDataRecordToDecodeTrade');
  }

  return {
    request: requestRecordsAsRequest({encoded, network}).request,
    auth: authDataRecord.value,
    payload: encryptedDataRecord.value,
  };
};
