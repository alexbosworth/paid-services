const decodeAnchoredTrade = require('./decode_anchored_trade');

/** Derive open trade details from an invoice

  {
    created_at: <Invoice Created At ISO 8601 Date String>
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
      [channel]: <Channel Sale Tokens Number>
      created_at: <Open Trade Created At ISO 8601 Date String>
      [description]: <Trade Description String>
      expires_at: <Trade Expires at ISO 8601 Date String>
      id: <Trade Id Hex String>
      [price]: <Price Expression String>
      [secret]: <Secret Payload String>
      [tokens]: <Tokens Number>
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
      channel: trade.channel || undefined,
      created_at: args.created_at,
      description: trade.description || undefined,
      expires_at: args.expires_at,
      id: args.id,
      price: trade.price || undefined,
      secret: trade.secret || undefined,
      tokens: args.tokens || undefined,
    },
  };
};
