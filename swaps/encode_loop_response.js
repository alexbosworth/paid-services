const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const {loopResponseTypes} = require('./swap_field_types');
const {requestAsRequestRecords} = require('./../records');

const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const {typeDepositRequest} = loopResponseTypes;
const {typeFundRequest} = loopResponseTypes;
const {typeMacaroon} = loopResponseTypes;
const {typePreimage} = loopResponseTypes;
const {typeRemotePublicKey} = loopResponseTypes;
const {typeTimeout} = loopResponseTypes;

/** Encode Lightning Loop response details

  {
    deposit: <BOLT 11 Deposit Request String>
    fund: <BOLT 11 Funding Request String>
    macaroon: <Access Macaroon Base64 String>
    preimage: <Paid Macaroon Unlock Secret Hex String>
    remote: <Service Refund Public Key Hex String>
    timeout: <Swap Timeout Path Height Number>
  }

  @throws
  <Error>

  @returns
  {
    response: <TLV Encoded Lightning Loop Response Details Hex String>
  }
*/
module.exports = ({deposit, fund, macaroon, preimage, remote, timeout}) => {
  if (!deposit) {
    throw new Error('ExpectedBoltDepositPaymentRequestToEncodeLoopResponse');
  }

  if (!fund) {
    throw new Error('ExpectedBoltFundPaymentRequestToEncodeLoopResponse');
  }

  if (!macaroon) {
    throw new Error('ExpectedAccessMacaroonToEncodeLoopResponse');
  }

  if (!preimage) {
    throw new Error('ExpectedMacaroonSecretToEncodeLoopResponse');
  }

  if (!remote) {
    throw new Error('ExpectedRemotePublicKeyToEncodeLoopResponse');
  }

  if (!timeout) {
    throw new Error('ExpectedTimeoutHeightToEncodeLoopResponse');
  }

  const records = [
    {
      type: typeDepositRequest,
      value: requestAsRequestRecords({request: deposit}).encoded,
    },
    {
      type: typeFundRequest,
      value: requestAsRequestRecords({request: fund}).encoded,
    },
    {
      type: typeMacaroon,
      value: base64AsHex(macaroon),
    },
    {
      type: typePreimage,
      value: preimage,
    },
    {
      type: typeRemotePublicKey,
      value: remote,
    },
    {
      type: typeTimeout,
      value: encodeBigSize({number: timeout.toString()}).encoded,
    },
  ];

  return {response: encodeTlvStream({records}).encoded};
};
