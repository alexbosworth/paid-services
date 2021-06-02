const {encodeTlvStream} = require('bolt01');

const {isArray} = Array;
const isUrl = n => { try { return !!(new URL(n)); } catch (e) { return !e; } };
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Encode a list of URLs

  {
    urls: [<URL String>]
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Hex Encoded URL String>
  }
*/
module.exports = ({urls}) => {
  if (!isArray(urls)) {
    throw new Error('ExpectedUrlsToEncodeAsUrlsRecord');
  }

  // Check for invalid URLs
  if (!!urls.filter(n => !isUrl(n)).length) {
    throw new Error('ExpectedValidUrlsToEncodeInUrlsRecord');
  }

  // Map the URLs into a TLV stream
  const records = urls.map((url, i) => {
    return {type: i.toString(), value: utf8AsHex(url)};
  });

  return {encoded: encodeTlvStream({records}).encoded};
};
