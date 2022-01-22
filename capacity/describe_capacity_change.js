const describeType = type => !(type & 1) ? 'private' : 'public';
const peerName = ({alias, id}) => `${alias} ${id.substring(0, 8)}`.trim();
const tokensAsBigUnit = tokens => (tokens / 1e8).toFixed(8);

/** Describe a capacity change

  {
    capacity: <Channel Capacity Tokens Number>
    channel: <Change Channel Id String>
    [decrease]: <Capacity Change Decrease Tokens Number>
    from_alias: <Peer Alias String>
    from_id: <Peer Public Key Hex String>
    [increase]: <Capacity Change Increase Tokens Number>
    [to_alias]: <Node Alias String>
    [to_id]: <Node Public Key Hex String>
    [type]: <Channel Type String>
  }

  @returns
  <Capacity Change Description String>
*/
module.exports = args => {
  const change = !!args.increase ? 'Increase' : 'Decrease';
  const delta = args.decrease || args.increase;
  const hasType = args.type !== undefined;
  const newPeer = peerName({alias: args.to_alias, id: args.to_id || ''});
  const peer = peerName({alias: args.from_alias, id: args.from_id});
  const size = tokensAsBigUnit(args.capacity);

  const action = `${change} capacity ${size} channel ${args.channel}`;
  const by = !!delta ? ` by ${tokensAsBigUnit(delta)}` : '';
  const move = !!args.to_id ? ` and move channel to ${newPeer}` : '';
  const type = hasType ? describeType(args.type) : '';

  const changeType = hasType ? ` and make channel ${type}` : '';

  return `${action} with ${peer}${by}${move}${changeType}?`;
};
