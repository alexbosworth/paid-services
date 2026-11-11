const {parseOffer} = require('invoices');
const {verifySchnorr} = require('tiny-secp256k1');

const menuSignaturePreimage = require('./menu_signature_preimage');

const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const isSignature = n => typeof n === 'string' && /^[0-9a-f]{128}$/i.test(n);

/** Determine if a support menu is signed by the support offer issuer

  {
    menu: <Support Menu TLV Stream Without Signature Hex String>
    offer: <BOLT 12 Support Offer String>
    signature: <BIP 340 Signature Hex String>
  }

  @returns
  {
    is_valid: <Signature Is By The Offer Issuer Id Bool>
  }
*/
module.exports = ({menu, offer, signature}) => {
  try {
    const issuerId = parseOffer({offer}).issuer_id;

    // There is no signature without an issuer id or a signature
    if (!issuerId || !isSignature(signature)) {
      return {is_valid: false};
    }

    const {hash} = menuSignaturePreimage({menu, offer});

    // BIP 340 keys are the x coordinate of the issuer id
    const isValid = verifySchnorr(
      hexAsBuffer(hash),
      hexAsBuffer(issuerId).subarray(1),
      hexAsBuffer(signature)
    );

    return {is_valid: isValid};
  } catch (err) {
    return {is_valid: false};
  }
};
