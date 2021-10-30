const {decodeTlvStream} = require('bolt01');

const networkFromNetworkRecord = require('./network_from_network_record');
const {requestRecordsAsRequest} = require('./../records');

const findAuth = records => records.find(n => n.type === '1');
const findCipher = records => records.find(n => n.type === '0');
const findDetails = records => records.find(n => n.type === '3');
const findEncrypt = records => records.find(n => n.type === '0');
const findNetwork = records => records.find(n => n.type === '1');
const findRequest = records => records.find(n => n.type === '2');
const findVersion = records => records.find(n => n.type === '0');
const isTrade = trade => trade.toLowerCase().startsWith('626f73ff');
const tradeData = trade => trade.slice('626f73ff'.length);

/** Encode a trade

  {
    trade: <Hex Encoded Trade String>
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
module.exports = ({trade}) => {
  if (!trade) {
    throw new Error('ExpectedTradeToDecode');
  }

  if (!isTrade(trade)) {
    throw new Error('UnexpectedFormatOfTradeToDecode');
  }

  try {
    decodeTlvStream({encoded: tradeData(trade)});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForTradeData');
  }

  // Decode the overall packet
  const tradeRecords = decodeTlvStream({encoded: tradeData(trade)}).records;

  // Get the trade version
  const version = findVersion(tradeRecords);

  if (!!version) {
    throw new Error('UnexpectedVersionOfTradeData');
  }

  // Get the network record
  const networkRecord = findNetwork(tradeRecords) || {};

  // Get the payment request record
  const requestRecord = findRequest(tradeRecords);

  if (!requestRecord) {
    throw new Error('ExpectedRequestRecordInTradeData');
  }

  const {request} = requestRecordsAsRequest({
    network: networkFromNetworkRecord({value: networkRecord.value}),
    encoded: requestRecord.value,
  });

  // Get the trade details
  const detailsRecord = findDetails(tradeRecords);

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
    request,
    auth: authDataRecord.value,
    payload: encryptedDataRecord.value,
  };
};
