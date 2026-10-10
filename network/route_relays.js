/** Get the relaying nodes of a message from a route found back to the source

  The route is found from the destination to the source, so the message goes
  back along it through the nodes in between. The first relaying node has to
  be a connected peer of the source.

  {
    destination: <Message Destination Public Key Hex String>
    peers: [{
      public_key: <Connected Peer Public Key Hex String>
    }]
    route: {
      hops: [{
        public_key: <Forward Edge Public Key Hex String>
      }]
    }
    source: <Message Source Public Key Hex String>
  }

  @returns
  {
    [ignore]: [{
      from_public_key: <Avoid Node Public Key Hex String>
      [to_public_key]: <Avoid Edge To Public Key Hex String>
    }]
    [relays]: [<Relaying Node Public Key Hex String>]
  }
*/
module.exports = ({destination, peers, route, source}) => {
  // The message goes back along the route, through the nodes in between
  const relays = route.hops.map(n => n.public_key).slice(0, -1).reverse();

  // The first hop of the message has to be a connected peer
  const [first] = !relays.length ? [destination] : relays;

  const peerKeys = peers.map(n => n.public_key);

  // Exit early and avoid the last edge when the first hop is not a peer
  if (!peerKeys.includes(first)) {
    return {ignore: [{from_public_key: first, to_public_key: source}]};
  }

  return {relays};
};
