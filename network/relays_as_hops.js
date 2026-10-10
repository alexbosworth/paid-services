const hasBit = (features, bits) => !!features.find(n => bits.includes(n.bit));
const relayBits = [38, 39];

/** Get message hops for relaying nodes when they all relay onion messages

  Nodes that relay onion messages signal feature bit 38 or 39

  {
    destination: <Message Destination Public Key Hex String>
    nodes: [{
      features: [{
        bit: <BOLT 09 Feature Bit Number>
      }]
    }]
    relays: [<Relaying Node Public Key Hex String>]
  }

  @returns
  {
    [hops]: [<Message Hop Public Key Hex String>]
    [ignore]: [{
      from_public_key: <Avoid Node Public Key Hex String>
    }]
  }
*/
module.exports = ({destination, nodes, relays}) => {
  const skip = relays.filter((key, i) => {
    return !nodes[i] || !hasBit(nodes[i].features || [], relayBits);
  });

  // Exit early and avoid the nodes that do not relay messages
  if (!!skip.length) {
    return {ignore: skip.map(key => ({from_public_key: key}))};
  }

  return {hops: relays.concat(destination)};
};
