const decodeTrade = require('./decode_trade');
const encodeTrade = require('./encode_trade');
const manageTrades = require('./manage_trades');
const serviceAnchoredTrades = require('./service_anchored_trades');

module.exports = {
  decodeTrade,
  encodeTrade,
  manageTrades,
  serviceAnchoredTrades,
};
