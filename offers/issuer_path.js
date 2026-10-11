const {blindedPathToNode} = require('bolt04');

/** Make a path to send an invoice request to the issuer id of an offer

  BOLT 12 sends requests for an offer without paths to its issuer id

  {
    id: <Offer Issuer Id Public Key Hex String>
  }

  @throws
  <Error>

  @returns
  {
    hops: [{
      encrypted_data: <Encrypted Recipient Data Hex String>
      relay_key: <Blinded Relaying Node Public Key Hex String>
    }]
    introduction_node: <Introduction Node Public Key Hex String>
    key: <First Hop Path Key Public Key Hex String>
  }
*/
module.exports = ({id}) => {
  const {key, path} = blindedPathToNode({hops: [id]});

  return {key, hops: path, introduction_node: id};
};
