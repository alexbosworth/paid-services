const {randomBytes} = require('node:crypto');

const {isPrivate} = require('tiny-secp256k1');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const secretBytes = 32;

/** Make a random secret key, like for a payer id that is used once

  @returns
  {
    secret: <Secret Key Hex String>
  }
*/
module.exports = () => {
  const secret = randomBytes(secretBytes);

  // Random bytes have a negligible chance of not being a valid secret key
  if (!isPrivate(secret)) {
    return module.exports();
  }

  return {secret: bufferAsHex(secret)};
};
