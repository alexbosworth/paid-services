const encodeOpenTrade = require('./encode_open_trade');
const encodeSwapTrade = require('./encode_swap_trade');
const encodeTradeSecret = require('./encode_trade_secret');

/** Encode v1 trade records

  A v1 trade is either a qualified trade with a request, or an open ended trade
  with connection details.

  0: version (v1)
  [1]: network
  [2]: payment request
  [3]: trade details
  [4]: nodes records
  [5]: trade identifier
  [6]: swap request

  {
    [connect]: {
      [id]: <Reference Trade Id Hex String>
      network: <Network Name String>
      nodes: [{
        channels: [<Standard Format Channel Id String>]
        id: <Node Public Key Id Hex String>
        [sockets]: [<Peer Socket String>]
      }]
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

  @throws
  <Error>

  @returns
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({connect, secret, swap}) => {
  if (!connect && !secret && !swap) {
    throw new Error('ExpectedTradeDetailsToEncode');
  }

  if (!!connect) {
    return encodeOpenTrade({
      id: connect.id,
      network: connect.network,
      nodes: connect.nodes,
    });
  }

  if (!!secret) {
    return encodeTradeSecret({
      auth: secret.auth,
      payload: secret.payload,
      request: secret.request,
    });
  }

  if (!!swap) {
    return encodeSwapTrade({node: swap.node, request: swap.request});
  }

  throw new Error('ExpectedTradeTypeToEncode');
};
