const coordinateGroup = require('./../../../groups/assemble/coordinate_group');
const {identity} = require('./group_members');
const makeLnd = require('./make_lnd');
const {member} = require('./group_members');
const requestGroup = require('./request_group');

/** Make a coordinator with a peer request helper

  @returns
  {
    id: <Group Id Hex String>
    partners: <Get Locked In Partners Function>
    request: <Send A Peer Request Function>
  }
*/
module.exports = () => {
  const {lnd, replies, subscription} = makeLnd();

  const group = coordinateGroup({
    identity,
    lnd,
    capacity: 100000,
    count: 2,
    members: [identity, member],
    rate: 1,
  });

  return {
    id: group.id,
    partners: group.partners,
    request: request => requestGroup({group, replies, request, subscription}),
  };
};
