/** Derive inbound and outbound partners from members list

  {
    group: {
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
  const [first] = group.ids;
  const reversed = group.ids.slice().reverse();

  const [last] = reversed;
  const [, next] = group.ids.slice(group.ids.indexOf(id));

  const [, previous] = reversed.slice(reversed.indexOf(id));

  return {inbound: previous || last, outbound: next || first};
};
