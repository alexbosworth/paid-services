const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const decodeOpenTrade = require('./decode_open_trade');
const decodeSwapTrade = require('./decode_swap_trade');
const decodeTradePayment = require('./decode_trade_payment');
const decodeTradeSecret = require('./decode_trade_secret');
const networkFromNetworkRecord = require('./network_from_network_record');

const findDetailsRecord = records => records.find(n => n.type === '3');
const findNetwork = records => records.find(n => n.type === '1');
const findVer = records => records.find(n => n.type === '0') || {value: '00'};
const findRequestRecord = records => records.find(n => n.type === '2');
const findSwapRecord = records => records.find(n => n.type === '6');
const isTrade = trade => trade.toLowerCase().startsWith('626f73ff');
const isValidVersion = version => BigInt(version) <= BigInt(2);
const tradeData = trade => trade.slice('626f73ff'.length);

/** Decode a trade record

  [0]: <Version Record>
  [1]: <Network Name Record>
  [2]: <Payment Request Record>
  [3]: <Trade Details Record
  [4]: <Nodes Records>
  [5]: <Trade Identifier>
  [6]: <Swap Request>

  {
    trade: <Trade Record Hex String>
  }

  @returns
  {
    [connect]: {
      [id]: <Reference Trade Id Hex String>
      network: <Network Name String>
      nodes: [{
        [high_channel]: <High Key Channel Id String>
        [low_channel]: <Low Key Channel Id String>
        [node]: {
          id: <Node Public Key Id Hex String>
          sockets: [<Peer Socket String>]
        }
      }]
    }
    [payment]: {
      request: <BOLT 11 Payment Request String>
    }
    [secret]: {
      auth: <Encrypted Payload Auth Hex String>
      payload: <Preimage Encrypted Payload Hex String>
      request: <BOLT 11 Payment Request String>
    }
    [swap]: {
      node: <Node Public Key Id Hex String>
      request: <Swap Request Hex String>
    }
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
  const {records} = decodeTlvStream({encoded: tradeData(trade)});

  // Get the trade version
  const versionRecord = findVer(records);

  // Decode the version number
  const version = decodeBigSize({encoded: versionRecord.value}).decoded;

  // Too-high versions cannot be parsed
  if (!isValidVersion(version)) {
    throw new Error('ExpectedKnownVersionToDecodeTrade');
  }

  // Get the network record
  const networkRecord = findNetwork(records) || {};

  // Decode the network record
  const {network} = networkFromNetworkRecord({value: networkRecord.value});

  const requestRecord = findRequestRecord(records);

  // Exit early when this is a secret to trade
  if (!!requestRecord && !!findDetailsRecord(records)) {
    return {secret: decodeTradeSecret({network, records})};
  }

  // Exit early when this is just a payment request
  if (!!requestRecord) {
    return {payment: decodeTradePayment({network, records})};
  }

  // Exit early when there is a swap encoded
  if (!!findSwapRecord(records)) {
    return {swap: decodeSwapTrade({records})};
  }

  return {connect: decodeOpenTrade({network, records})};
};
