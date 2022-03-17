const {decodeTlvStream} = require('bolt01');

const anchorPrefix = 'anchor-trade-secret:';
const base64AsHex = base64 => Buffer.from(base64, 'base64').toString('hex');
const findDescription = records => records.find(n => n.type === '1');
const findSecret = records => records.find(n => n.type === '0');
const findPrice = records => records.find(n => n.type === '2');
const hexAsUtf = n => !n ? '' : Buffer.from(n.value, 'hex').toString('utf8');

/** Decode an anchored trade data blob

  Data blobs look like anchored-trade-secret:<base64-encoded-data>

  Inside the base64 is encoded TLV data:
  0: <Trade Secret>
  [1]: <Trade Description>

  {
    encoded: <Encoded Trade Data String>
  }

  @returns
  {
    [trade]: {
      description: <Description of Trade String>
      secret: <Trade Secret String>
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

  const secret = findSecret(records);

  if (!secret.value) {
    return {};
  }

  return {
    trade: {
      description: hexAsUtf(findDescription(records)),
      price: hexAsUtf(findPrice(records)),
      secret: hexAsUtf(secret),
    },
  };
};
