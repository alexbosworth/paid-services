const makeGroup = require('./make_group');
const {outsider} = require('./group_members');
const {serviceTypeFindGroupPartners} = require('./../../../service_types');

/** Request a locked group from a node outside its membership

  {
    type: <Peer Request Type Number String>
  }

  @returns
  <Peer Response Failure Array>
*/
module.exports = args => {
  const group = makeGroup();

  group.request({type: serviceTypeFindGroupPartners});

  const reply = group.request({from: outsider, type: args.type});

  return reply.response.failure;
};
