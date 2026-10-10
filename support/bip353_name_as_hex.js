const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const isName = n => typeof n === 'string' && namePattern.test(n);
const namePattern = /^[0-9a-zA-Z\-_.]+@[0-9a-zA-Z\-_.]+$/;
const maxPartBytes = 255;

/** Encode a BIP 353 human readable name as in `invreq_bip_353_name`

  The user and the domain are each after a single length byte.

  {
    bip353_name: <BIP 353 Human Readable Name String>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Encoded BIP 353 Name Hex String>
  }
*/
module.exports = args => {
  if (!isName(args.bip353_name)) {
    throw new Error('ExpectedUserAtDomainBip353NameToEncode');
  }

  const parts = args.bip353_name.split('@').map(n => Buffer.from(n, 'ascii'));

  if (!parts.every(n => n.length <= maxPartBytes)) {
    throw new Error('ExpectedShorterBip353NamePartsToEncode');
  }

  const encoded = parts.map(n => Buffer.concat([Buffer.from([n.length]), n]));

  return {encoded: bufferAsHex(Buffer.concat(encoded))};
};
