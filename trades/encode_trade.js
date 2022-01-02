const encodeOpenTrade = require('./encode_open_trade');
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
  }

  @throws
  <Error>

  @returns
  {
    trade: <Hex Encoded Trade String>
  }
*/
module.exports = ({connect, secret}) => {
  if (!connect && !secret) {
    throw new Error('ExpectedEitherConnectDetailsOrTradeSecret');
  }

  if (!!connect && !!secret) {
    throw new Error('ExpectedEitherConnectDetailsOrTradeSecretNotBoth');
  }

  // Exit early when this is an open ended trade
  if (!!connect) {
    return encodeOpenTrade({
      id: connect.id,
      network: connect.network,
      nodes: connect.nodes,
    });
  }

  // Encode the trade secret
  return encodeTradeSecret({
    auth: secret.auth,
    payload: secret.payload,
    request: secret.request,
  });
};
