const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');

const anchorPrefix = 'anchor-trade-secret:';
const descriptionRecord = value => !!value ? ({value, type: '1'}) : undefined;
const priceRecord = value => !!value ? ({value, type: '2'}) : undefined;
const secretRecord = value => !!value ? ({value, type: '0'}) : undefined;
const typeForChannelSale = '3';
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
const withPrefix = (pre, v) => pre + Buffer.from(v, 'hex').toString('base64');

/** Encode a trade into an anchor blob

  This will look like anchored-trade-secret:<base64-encoded-data>

  The data encodes a TLV:
  [0]: <Trade Secret>
  [1]: <Trade Description>
  [2]: <Price Expression>
  [3]: <Channel Sale Tokens>

  {
    [channel]: <Channel Sale Tokens Number>
    [description]: <Open Trade Description String>
    [price]: <Trade Price String>
    [secret]: <Open Trade Secret String>
  }

  @returns
  {
    encoded: <Encoded Anchor Trade Data Blob String>
  }
*/
module.exports = ({channel, description, price, secret}) => {
  const elements = [
    secretRecord(secret),
    descriptionRecord(description),
    priceRecord(price),
  ];

  const records = elements
    .filter(n => !!n)
    .map(({type, value}) => ({type, value: utf8AsHex(value)}));

  if (!!channel) {
    records.push({
      type: typeForChannelSale,
      value: encodeBigSize({number: channel.toString()}).encoded,
    });
  }

  const {encoded} = encodeTlvStream({records});

  return {encoded: withPrefix(anchorPrefix, encoded)};
};
