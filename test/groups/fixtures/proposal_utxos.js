// Make a native SegWit input script
const scriptPub = byte => `0014${byte.repeat(20)}`;
// Make a repeatable transaction id
const transactionId = byte => byte.repeat(32);

module.exports = [{
  non_witness_utxo: undefined,
  transaction_id: transactionId('44'),
  transaction_vout: 0,
  witness_utxo: {script_pub: scriptPub('55'), tokens: 100200},
}];
