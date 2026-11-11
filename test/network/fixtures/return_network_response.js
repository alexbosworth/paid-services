const {blindedPathFromHops} = require('bolt04');

const peer = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';

/** Make the reply path that the tests of returning a network response share

  The path starts at the peer of the key of secret 2. It is blinded with
  random keys, so it is made once and every test gets the same path.

  @returns
  {
    reply: {
      inbound: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Node Public Key Hex String>
      }]
      introduction_node: <Introduction Node Public Key Hex String>
      key: <Path Key Hex String>
    }
  }
*/
module.exports = (() => {
  const {key, path} = blindedPathFromHops({hops: [peer]});

  return {reply: {key, inbound: path, introduction_node: peer}};
})();
