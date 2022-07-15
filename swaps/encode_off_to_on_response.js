const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parsePaymentRequest} = require('ln-service');

const encodeSwapSecrets = require('./encode_swap_secrets');
const {requestAsRequestRecords} = require('./../records');
const {publicTypes} = require('./swap_field_types');
const {swapVersion} = require('./swap_field_types');

const encode = records => encodeTlvStream({records}).encoded;
const encodeNumber = n => encodeBigSize({number: n.toString()}).encoded;

const {typeClaimCoopPublicKeyHash} = publicTypes;
const {typeClaimSoloPublicKey} = publicTypes;
const {typeDeposit} = publicTypes;
const {typeHash} = publicTypes;
const {typeInboundPeer} = publicTypes;
const {typePush} = publicTypes;
const {typePrivateRefundDetails} = publicTypes;
const {typeRefundCoopPrivateKeyHash} = publicTypes;
const {typeRefundCoopPublicKey} = publicTypes;
const {typeRefundSoloPublicKey} = publicTypes;
const {typeRequest} = publicTypes;
const {typeTimeout} = publicTypes;
const {typeTokens} = publicTypes;
const {typeVersion} = publicTypes;

/** Serialize off to on swap records

  {
    claim_public_key: <Claim Path Unilateral Public Key Hex String>
    coop_private_key: <Refund Cooperative Private Key Hex String>
    coop_public_key: <Refund Cooperative Key Hex String>
    coop_public_key_hash: <Claim Cooperative Public Key Hash String>
    deposit: <Deposit BOLT 11 Request String>
    encrypt: <Encrypt Secrets Base Encryption Key Hex String>
    hash: <Swap Hash Hex String>
    [incoming_peer]: <Constrained to Inbound Peer Public Key Id Hex String>
    [key_index]: <Refund Unilateral Key Id Number>
    push: <BOLT 11 Encoded Push Request String>
    refund_public_key: <Refund Unilateral Public Key Hex String>
    request: <BOLT 11 Encoded Funding Request String>
    [solo_private_key]: <Refund Path Unilateral Private Key Hex String>
    timeout: <Timeout Block Height Constraint Number>
    tokens: <Fund Tokens Number>
  }

  @returns
  {
    recovery: <Serialized Swap Records Hex String>
    response: <Serialized Response Records Hex String>
  }
*/
module.exports = args => {
  const deposit = parsePaymentRequest({request: args.deposit});
  const request = requestAsRequestRecords({request: args.request}).encoded;
  const timeout = encodeBigSize({number: args.timeout.toString()}).encoded;

  const depositAmount = encodeBigSize({number: deposit.mtokens}).encoded;
  const privateCoopKeyHash = deposit.id;
  const swapHash = parsePaymentRequest({request: args.request}).id;

  const responseRecords = [
    {
      type: typeDeposit,
      value: deposit.payment + depositAmount,
    },
    {
      type: typeInboundPeer,
      value: args.incoming_peer,
    },
    {
      type: typeRefundCoopPrivateKeyHash,
      value: privateCoopKeyHash,
    },
    {
      type: typeRefundCoopPublicKey,
      value: args.coop_public_key,
    },
    {
      type: typeRefundSoloPublicKey,
      value: args.refund_public_key,
    },
    {
      type: typePush,
      value: parsePaymentRequest({request: args.push}).payment,
    },
    {
      type: typeRequest,
      value: request,
    },
    {
      type: typeTimeout,
      value: timeout,
    },
    {
      type: typeVersion,
      value: encodeNumber(swapVersion),
    },
  ];

  const {encoded} = encodeSwapSecrets({
    coop_private_key: args.coop_private_key,
    encrypt: args.encrypt,
    hash: swapHash,
    key_index: args.key_index,
    solo_private_key: args.solo_private_key,
  });

  const recoveryRecords = [
    {
      type: typeClaimCoopPublicKeyHash,
      value: args.coop_public_key_hash,
    },
    {
      type: typeClaimSoloPublicKey,
      value: args.claim_public_key,
    },
    {
      type: typeHash,
      value: swapHash,
    },
    {
      type: typeInboundPeer,
      value: args.incoming_peer,
    },
    {
      type: typePrivateRefundDetails,
      value: encoded,
    },
    {
      type: typeRefundCoopPrivateKeyHash,
      value: privateCoopKeyHash,
    },
    {
      type: typeTimeout,
      value: timeout,
    },
    {
      type: typeTokens,
      value: encodeNumber(args.tokens),
    },
    {
      type: typeVersion,
      value: encodeNumber(swapVersion),
    },
  ];

  return {
    recovery: encode(recoveryRecords.filter(n => !!n.value)),
    response: encode(responseRecords.filter(n => !!n.value)),
  };
};
