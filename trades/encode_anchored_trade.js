const {encodeTlvStream} = require('bolt01');

const anchorPrefix = 'anchor-trade-secret:';
const descriptionRecord = value => !!value ? ({value, type: '1'}) : undefined;
const hasFiat = n => /(aud|cad|eur|gbp|inr|jpy|usd)/gim.test(n);
const priceRecord = value => !!hasFiat(value) ? ({value, type: '2'}) : undefined;
const secretRecord = value => ({value, type: '0'});
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
const withPrefix = (pre, v) => pre + Buffer.from(v, 'hex').toString('base64');

/** Encode a trade into an anchor blob

  This will look like anchored-trade-secret:<base64-encoded-data>

  The data encodes a TLV:
  0: <Trade Secret>
  [1]: <Trade Description>

  {
    [description]: <Open Trade Description String>
    price: <Trade Price String>
    secret: <Open Trade Secret String>
  }

  @returns
  {
    encoded: <Encoded Anchor Trade Data Blob String>
  }
*/
module.exports = ({description, price, secret}) => {
  const records = [secretRecord(secret), descriptionRecord(description), priceRecord(price)]
    .filter(n => !!n)
    .map(({type, value}) => ({type, value: utf8AsHex(value)}));

  const {encoded} = encodeTlvStream({records});

  return {encoded: withPrefix(anchorPrefix, encoded)};
};
