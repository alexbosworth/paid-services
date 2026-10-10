const {createHash} = require('node:crypto');

const {parseOffer} = require('invoices');

const bitcoinChains = require('./bitcoin_chains');
const {menuSignatureTag} = require('./constants');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const {readServiceLabel} = require('./../service_records');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const lengthServiceIdHex = 32;
const sha256 = n => createHash('sha256').update(n).digest();

/** Get what a support menu signature signs: the tagged hash of the identity
  of the support offer and the menu bytes without the signature record

  The identity is the chain hash of the network, the issuer id, and the
  service id, which stay the same when the offer changes.

  {
    menu: <Support Menu TLV Stream Without Signature Hex String>
    offer: <BOLT 12 Support Offer String>
  }

  @throws
  <Error>

  @returns
  {
    hash: <Tagged Hash To Sign Hex String>
    preimage: <Bytes To Hash With The Tag Hex String>
    tag: <BIP 340 Tag String>
  }
*/
module.exports = ({menu, offer}) => {
  if (!isHex(menu)) {
    throw new Error('ExpectedMenuTlvStreamToGetMenuSignaturePreimage');
  }

  const {issuer_id} = parseOffer({offer});
  const {network} = offerBitcoinNetwork({offer});
  const {id} = readServiceLabel({offer});

  if (!network) {
    throw new Error('ExpectedSupportOfferNetworkToGetMenuSignaturePreimage');
  }

  if (!issuer_id) {
    throw new Error('ExpectedSupportOfferIssuerIdToGetMenuSignaturePreimage');
  }

  if (!id || id.length !== lengthServiceIdHex) {
    throw new Error('ExpectedSupportOfferServiceIdToGetMenuSignaturePreimage');
  }

  const preimage = Buffer.concat([
    hexAsBuffer(bitcoinChains[network]),
    hexAsBuffer(issuer_id),
    hexAsBuffer(id),
    hexAsBuffer(menu),
  ]);

  const tagHash = sha256(Buffer.from(menuSignatureTag, 'utf8'));

  const hash = sha256(Buffer.concat([tagHash, tagHash, preimage]));

  return {
    hash: bufferAsHex(hash),
    preimage: bufferAsHex(preimage),
    tag: menuSignatureTag,
  };
};
