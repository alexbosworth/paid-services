const {onionForPath} = require('bolt04');

const {floor} = Math;
const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const isLargeOnion = onion => onion.length / 2 === largeOnionBytes;
const largeOnionBytes = 32834;
const lengthPayloadsBytes = 1300;
const middleOf = (low, high) => floor((low + high) / 2);

/** Get the most bytes of a reply, the single payload record of the final
  hop, that fit in an onion message of the regular size over a reply path

  {
    inbound: [{
      encrypted_data: <Encrypted Data Hex String>
      relay_key: <Blinded Relay Key Hex String>
    }]
    key: <Reply Path Key Hex String>
    outbound: [<Relaying Node Public Key Hex String>]
    type: <Reply Payload Record Type Number String>
  }

  @throws
  <Error>

  @returns
  {
    bytes: <Most Reply Payload Bytes That Fit, -1 When None Fit Number>
  }
*/
module.exports = ({inbound, key, outbound, type}) => {
  // A reply of a length fits when its onion is of the regular size
  const isFitting = bytes => {
    const {onion} = onionForPath({
      inbound,
      key,
      outbound,
      records: [{type, value: bufferAsHex(Buffer.alloc(bytes))}],
    });

    return !isLargeOnion(onion);
  };

  // Exit early when even an empty reply does not fit. The bytes are -1, not
  // 0, which would mean that an empty reply fits, or undefined, which every
  // size would compare false against: every reply is larger than -1
  if (!isFitting(Number())) {
    return {bytes: -1};
  }

  let fits = Number();
  let doesNotFit = lengthPayloadsBytes;

  // Find the most bytes that fit
  while (doesNotFit - fits > 1) {
    const middle = middleOf(fits, doesNotFit);

    if (isFitting(middle)) {
      fits = middle;
    } else {
      doesNotFit = middle;
    }
  }

  return {bytes: fits};
};
