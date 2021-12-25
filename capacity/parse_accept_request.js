const {Transaction} = require('bitcoinjs-lib');

const findTxRecord = records => records.find(n => n.type === '1');
const {fromHex} = Transaction;

/** Parse channel capacity change accept request

  {
    open_transaction: <Channel Funding Transaction Hex String>
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

  // Exit early when there is a local open transaction
  if (!!args.open_transaction) {
    return {transaction: args.open_transaction};
  }

  const txRecord = findTxRecord(args.records);

  // Exit early when there is no tx record
  if (!txRecord) {
    return {};
  }

  // Check to make sure there is a TX record
  try {
    fromHex(txRecord.value);
  } catch (err) {
    throw new Error('ExpectedValidRawTransactionHexToParseAcceptResponse');
  }

  const txId = fromHex(txRecord.value).getId();

  // Check to make sure the TX record matches the tx id
  if (txId !== args.transaction_id) {
    throw new Error('ExpectedTxRecordForRawChannelTransaction');
  }

  return {transaction: txRecord.value};
};
