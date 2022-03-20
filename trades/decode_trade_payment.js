const {requestRecordsAsRequest} = require('./../records');

const findRequest = records => records.find(n => n.type === '2');
const {isArray} = Array;

/** Decode a trade payment request

  2: <Payment Request Record>

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
    request: <BOLT 11 Payment Request String>
  }
*/
module.exports = ({network, records}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToDecodeTradePayment');
  }

  if (!isArray(records)) {
    throw new Error('ExpectedArrayOfRecordsToDecodeTradePayment');
  }

  // Get the payment request record
  const requestRecord = findRequest(records);

  if (!requestRecord) {
    throw new Error('ExpectedRequestRecordInTradeDataForTradePayment');
  }

  const encoded = requestRecord.value;

  return {request: requestRecordsAsRequest({encoded, network}).request};
};
