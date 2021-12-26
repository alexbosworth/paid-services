const {Transaction} = require('bitcoinjs-lib');

const findTxRecord = records => records.find(n => n.type === '1');
const {fromHex} = Transaction;

/** Parse channel capacity change accept response

  {
    records: [{
      type: <Record Type Number String>
      value: <Record Value Hex Encoded String>
    }]
    transaction_id: <Channel to Capacity Change Transaction Id Hex String>
  }

  @throws
  <Error>

  @returns
  {
    transaction: <Channel Open Transaction Hex String>
  }
*/
module.exports = args => {
  // Exit early when there are no records
  if (!args.records) {
    return {};
  }

  const txRecord = findTxRecord(args.records);

  // Exit early when there is no tx record
  if (!txRecord) {
    return {};
  }

  // Make sure that the tx record is a tx
  try {
    fromHex(txRecord.value);
  } catch (err) {
    throw new Error('ExpectedValidRawTransactionHexToParseAcceptResponse');
  }

  const txId = fromHex(txRecord.value).getId();

  // Make sure that the tx matches the tx id
  if (txId !== args.transaction_id) {
    throw new Error('ExpectedTxRecordForRawChannelTransaction');
  }

  return {transaction: txRecord.value};
};
