const {createHash} = require('node:crypto');

const bitcoinChains = require('./bitcoin_chains');
const {payerOfferSignatureTag} = require('./constants');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isKey = n => typeof n === 'string' && /^0[23][0-9a-f]{64}$/i.test(n);
const sha256 = n => createHash('sha256').update(n).digest();

/** Get the preimage and hash that a payer offer signature signs

    payer_offer_hash = SHA256(SHA256(tag) || SHA256(tag) || chain_hash ||
      invreq_payer_id || payer_offer)

  {
    network: <Paid Support Offer Bitcoin Network Name String>
    payer_id: <Invoice Request Payer Id Public Key Hex String>
    unsigned: <Payer Offer TLV Stream Without Signature Hex String>
  }

  @throws
  <Error>

  @returns
  {
    hash: <Payer Offer Hash Hex String>
    preimage: <Signed Preimage Hex String>
    tag: <Signature Tag String>
  }
*/
module.exports = args => {
  if (!bitcoinChains[args.network]) {
    throw new Error('ExpectedNetworkToGetPayerOfferSignaturePreimage');
  }

  if (!isKey(args.payer_id)) {
    throw new Error('ExpectedPayerIdToGetPayerOfferSignaturePreimage');
  }

  if (!isHex(args.unsigned) || !args.unsigned) {
    throw new Error('ExpectedPayerOfferToGetPayerOfferSignaturePreimage');
  }

  const preimage = Buffer.concat([
    hexAsBuffer(bitcoinChains[args.network]),
    hexAsBuffer(args.payer_id),
    hexAsBuffer(args.unsigned),
  ]);

  const tagHash = sha256(Buffer.from(payerOfferSignatureTag, 'utf8'));

  return {
    hash: bufferAsHex(sha256(Buffer.concat([tagHash, tagHash, preimage]))),
    preimage: bufferAsHex(preimage),
    tag: payerOfferSignatureTag,
  };
};
