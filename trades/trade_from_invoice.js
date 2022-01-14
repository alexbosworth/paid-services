const decodeAnchoredTrade = require('./decode_anchored_trade');

/** Derive open trade details from an invoice

  {
    description: <Invoice Description String>
    id: <Invoice Id Hex String>
    expires_at: <Invoice Expiration ISO 8601 Date String>
    [is_canceled]: <Invoice is Canceled Bool>
    is_confirmed: <Invoice is Confirmed Bool>
    [is_push]: <Invoice is Push Payment Bool>
    tokens: <Invoiced Amount Number>
  }

  @returns
  {
    [trade]: {
      description: <Trade Description String>
      expires_at: <Trade Expires at ISO 8601 Date String>
      id: <Trade Id Hex String>
      secret: <Secret Payload String>
      tokens: <Tokens Number>
    }
  }
*/
module.exports = args => {
  if (!args.description || !!args.is_canceled || !!args.is_confirmed) {
    return {};
  }

  if (!!args.is_push || !args.tokens) {
    return {};
  }

  const {trade} = decodeAnchoredTrade({encoded: args.description});

  // Exit early when the invoice doesn't match an anchored trade
  if (!trade) {
    return {};
  }

  return {
    trade: {
      description: trade.description,
      expires_at: args.expires_at,
      id: args.id,
      secret: trade.secret,
      tokens: args.tokens,
    },
  };
};
