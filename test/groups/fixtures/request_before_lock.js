const {identity} = require('./group_members');
const makeGroup = require('./make_group');
const {member} = require('./group_members');
const {outsider} = require('./group_members');
const {serviceTypeFindGroupPartners} = require('./../../../service_types');

/** Summarize early failures and the subsequent membership lock

  {
    type: <Peer Request Type Number String>
  }

  @returns
  {
    failures: [<Peer Response Failure Array>]
    partners: <Locked In Partners Object>
  }
*/
module.exports = args => {
  const group = makeGroup();

  // Early requests must not prevent membership from locking normally
  const failures = [member, outsider].map(from => {
    const reply = group.request({from, type: args.type});

    return reply.response.failure;
  });

  group.request({type: serviceTypeFindGroupPartners});

  return {failures, partners: group.partners(identity)};
};
