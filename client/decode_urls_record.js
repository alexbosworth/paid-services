const {URL} = require('url');

const {decodeTlvStream} = require('bolt01');

const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');
const isUrl = n => {try { return !!(new URL(n)); } catch (e) { return !e; }};

/** Decode a URLs record

  {
    encoded: <Encoded Nodes Hex String>
  }

  @throws
  <Error>

  @returns
  {
    urls: [<URL String>]
  }
*/
module.exports = ({encoded}) => {
  if (!encoded) {
    throw new Error('ExpectedEncodedUrlsHexString');
  }

  // Check that the encoded data can be decoded as TLV
  try {
    decodeTlvStream({encoded});
  } catch (err) {
    throw new Error('ExpectedValidTlvStreamForEncodedUrls');
  }

  const {records} = decodeTlvStream({encoded});

  // Every record maps to a URL
  const urls = records.map(n => hexAsUtf8(n.value));

  // Check that the URLs are all valid
  if (!!urls.filter(n => !isUrl(n)).length) {
    throw new Error('ExpectedArrayOfValidUrlsInUrlsListRecord');
  }

  return {urls};
};
