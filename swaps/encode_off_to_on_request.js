const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const encodeSwapSecrets = require('./encode_swap_secrets');
const {publicTypes} = require('./swap_field_types');

const {typeClaimCoopPublicKeyHash} = publicTypes;
const {typeClaimSoloPublicKey} = publicTypes;
const {typeHash} = publicTypes;
const {typePrivateClaimDetails} = publicTypes;
const {typeTokens} = publicTypes;

/** Serialize claim records

  {
    coop_private_key: <Cooperative Private Key Hex String>
    coop_public_key_hash: <Claim Cooperative Key Hash Hex String>
    encrypt: <Encrypt Secrets Base Encryption Key Hex String>
    hash: <Swap Claim Hash Hex String>
    [key_index]: <Claim Key Id Number>
    public_key: <Claim Unilateral Public Key Hex String>
    secret: <Swap Claim Secret Hex String>
    [solo_private_key]: <Claim Key Hex String>
    tokens: <Tokens Number>
  }

  @returns
  {
    recovery: <Serialized Claim Records Hex String>
    request: <Serialized Request Records Hex String>
  }
*/
module.exports = args => {
  // Request records to send to swap partner
  const request = [
    {
      type: typeClaimCoopPublicKeyHash,
      value: args.coop_public_key_hash,
    },
    {
      type: typeClaimSoloPublicKey,
      value: args.public_key,
    },
    {
      type: typeHash,
      value: args.hash,
    },
    {
      type: typeTokens,
      value: encodeBigSize({number: args.tokens.toString()}).encoded,
    },
  ];

  const {encoded} = encodeSwapSecrets({
    coop_private_key: args.coop_private_key,
    encrypt: args.encrypt,
    hash: args.hash,
    key_index: args.key_index,
    secret: args.secret,
    solo_private_key: args.solo_private_key,
  });

  const recovery = [
    {
      type: typeHash,
      value: args.hash,
    },
    {
      type: typePrivateClaimDetails,
      value: encoded,
    },
    {
      type: typeTokens,
      value: encodeBigSize({number: args.tokens.toString()}).encoded,
    },
  ];

  return {
    recovery: encodeTlvStream({records: recovery}).encoded,
    request: encodeTlvStream({records: request}).encoded,
  };
};
