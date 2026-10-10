const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isPart = n => /^[0-9a-zA-Z\-_.]+$/.test(n);

/** Decode a BIP 353 human readable name encoded as in `invreq_bip_353_name`

  {
    encoded: <Encoded BIP 353 Name Hex String>
  }

  @throws
  <Error>

  @returns
  {
    bip353_name: <BIP 353 Human Readable Name String>
  }
*/
module.exports = ({encoded}) => {
  if (!isHex(encoded)) {
    throw new Error('ExpectedHexEncodedBip353NameToDecode');
  }

  const bytes = Buffer.from(encoded, 'hex');

  let offset = 0;

  // The user and the domain are each after a single length byte
  const [user, domain] = [0, 1].map(() => {
    if (bytes.length < offset + 1) {
      throw new Error('ExpectedLengthByteInEncodedBip353Name');
    }

    const end = offset + 1 + bytes.readUInt8(offset);

    if (bytes.length < end) {
      throw new Error('ExpectedNamePartInEncodedBip353Name');
    }

    const part = bytes.subarray(offset + 1, end).toString('latin1');

    offset = end;

    return part;
  });

  if (offset !== bytes.length) {
    throw new Error('UnexpectedTrailingBytesInEncodedBip353Name');
  }

  if (!isPart(user) || !isPart(domain)) {
    throw new Error('ExpectedValidCharactersInBip353Name');
  }

  return {bip353_name: `${user}@${domain}`};
};
