const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const anchorPrefix = 'anchor-trade-secret:';
const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const decodeNumber = encoded => Number(decodeBigSize({encoded}).decoded);
const findChannel = records => records.find(n => n.type === '3');
const findDescription = records => records.find(n => n.type === '1');
const findSecret = records => records.find(n => n.type === '0');
const findPrice = records => records.find(n => n.type === '2');
const hexAsUtf = n => !n ? '' : Buffer.from(n.value, 'hex').toString('utf8');

/** Decode an anchored trade data blob

  Data blobs look like anchored-trade-secret:<base64-encoded-data>

  Inside the base64 is encoded TLV data:
  [0]: <Trade Secret>
  [1]: <Trade Description>
  [2]: <Price Expression>
  [3]: <Channel Sale Tokens>

  {
    encoded: <Encoded Trade Data String>
  }

  @returns
  {
    [trade]: {
      [channel]: <Channel Sale Capacity Tokens Number>
      [description]: <Description of Trade String>
      [price]: <Trade Price String>
      [secret]: <Trade Secret String>
    }
  }
*/
module.exports = ({encoded}) => {
  if (!encoded.startsWith(anchorPrefix)) {
    return {};
  }

  const data = encoded.slice(anchorPrefix.length);

  try {
    decodeTlvStream({encoded: base64AsHex(data)});
  } catch (err) {
    return {};
  }

  const {records} = decodeTlvStream({encoded: base64AsHex(data)});

  const channel = findChannel(records);
  const description = findDescription(records);
  const price = findPrice(records);
  const secret = findSecret(records);

  if (!!channel) {
    // Make sure the channel value is reasonable
    try {
      decodeNumber(channel.value);
    } catch {
      return {};
    }

    return {
      trade: {
        channel: decodeNumber(channel.value),
        price: !!price ? hexAsUtf(price) : undefined,
      },
    };
  }

  if (!!description && !!secret) {
    return {
      trade: {
        description: hexAsUtf(description),
        price: !!price ? hexAsUtf(price) : undefined,
        secret: hexAsUtf(secret),
      },
    };
  }

  return {};
};
