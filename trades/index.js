const createAnchoredTrade = require('./create_anchored_trade');
const decodeTrade = require('./decode_trade');
const encodeTrade = require('./encode_trade');
const getAnchoredTrade = require('./get_anchored_trade');
const manageTrades = require('./manage_trades');
const serviceAnchoredTrades = require('./service_anchored_trades');

module.exports = {
  createAnchoredTrade,
  decodeTrade,
  encodeTrade,
  getAnchoredTrade,
  manageTrades,
  serviceAnchoredTrades,
};
