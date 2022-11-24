const minGroupCount = 2;

/** Derive inbound and outbound partners from members list

  {
    group: {
      allowed: [<Allowed Public Key Id Hex String>]
      ids: [<Public Key Id Hex String>]
    }
    id: <Identity Public Key Hex String>
  }

  @returns
  {
    inbound: <Inbound Public Key Id Hex String>
    outbound: <Outbound Public Key Id Hex String>
  }
*/
module.exports = ({group, id}) => {
  // Exit early when the group only has a pair and there is only one partner
  if (group.ids.length === minGroupCount) {
    return {inbound: group.ids.find(n => n !== id)};
  }

  const ids = group.allowed || group.ids;

  const [first] = ids;
  const reversed = ids.slice().reverse();

  const [last] = reversed;
  const [, next] = ids.slice(ids.indexOf(id));

  const [, previous] = reversed.slice(reversed.indexOf(id));

  return {inbound: previous || last, outbound: next || first};
};
