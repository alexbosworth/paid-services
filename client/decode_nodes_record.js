const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const split = encoded => encoded.match(/.{1,66}/g);

/** Decode a nodes record

  {
    encoded: <Encoded Nodes Hex String>
  }

  @throws
  <Error>

  @returns
  {
    nodes: [<Node Hex Public Key String>]
  }
*/
module.exports = ({encoded}) => {
  if (!encoded) {
    throw new Error('ExpectedEncodedNodesHexString');
  }

  const nodes = split(encoded);

  if (!!nodes.filter(n => !isPublicKey(n)).length) {
    throw new Error('ExpectedArrayOfPublicKeysInNodeListRecord');
  }

  return {nodes};
};
