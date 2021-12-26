const {Transaction} = require('bitcoinjs-lib');

const {fromHex} = Transaction;
const findTransactionRecord = records => records.find(n => n.type === '1');
const txIdAsHash = id => Buffer.from(id, 'hex').reverse();

/** Parse request records requesting signing a capacity change request

  {
    id: <Funding Transaction Id Hex String>
    increase: <Increase By Tokens Number String>
    records: [{
      type: <Record Type Number String>
      value: <Record Value Hex Encoded String>
    }]
    vout: <Funding Transaction Output Index Number>
  }

  @throws
  <Error>

  @returns
  {
    unsigned: <Unsigned Transaction Replacement Hex String>
  }
*/
module.exports = ({id, increase, records, vout}) => {
  const txRecord = findTransactionRecord(records);

  if (!txRecord) {
    throw new Error('ExpectedTransactionRecordInSignCapacityChangeRequest');
  }

  // Check that the unsigned tx is a tx
  try {
    fromHex(txRecord.value);
  } catch (err) {
    throw new Error('FailedToParseSignCapacityChangeRequestTransaction');
  }

  const hash = txIdAsHash(id);
  const tx = fromHex(txRecord.value);

  const fundingSpend = tx.ins.filter(input => {
    return input.index === vout && input.hash.equals(hash);
  });

  // Make sure that the tx spends the funding tx outpoint
  if (!fundingSpend.length) {
    throw new Error('ExpectedSpendOfFundingTransactionInChangeRequestTx');
  }

  // Make sure that an increase has an additional input
  if (!!increase && tx.ins.length === [fundingSpend].length) {
    throw new Error('ExpectedAddedInputInChangeTxForChangeCapacityIncrease');
  }

  return {unsigned: txRecord.value};
};
