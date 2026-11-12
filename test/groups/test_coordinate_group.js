const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {member} = require('./fixtures/group_members');
const requestBeforeLock = require('./fixtures/request_before_lock');
const requestNonmember = require('./fixtures/request_nonmember');
const requestOtherGroup = require('./fixtures/request_other_group');
const {serviceTypeRegisterPendingOpen} = require('./../../service_types');
const {serviceTypeRegisterSignedOpen} = require('./../../service_types');

const denied = [403, 'MembershipNotPresentInLockedInMembers'];
const pending = [503, 'GroupMembersAreNotLockedInToRegisterPendingOpen'];
const signed = [503, 'GroupMembersAreNotLockedInToRegisterSignedOpen'];

const tests = [
  {
    args: {type: serviceTypeRegisterPendingOpen},
    description: 'A pending open before membership locks returns a failure',
    expected: {failures: [pending, pending], partners: {inbound: member}},
    method: requestBeforeLock,
  },
  {
    args: {type: serviceTypeRegisterSignedOpen},
    description: 'A signed open before membership locks returns a failure',
    expected: {failures: [signed, signed], partners: {inbound: member}},
    method: requestBeforeLock,
  },
  {
    args: {type: serviceTypeRegisterPendingOpen},
    description: 'A pending open for another group is ignored before locking',
    expected: undefined,
    method: requestOtherGroup,
  },
  {
    args: {type: serviceTypeRegisterSignedOpen},
    description: 'A signed open for another group is ignored before locking',
    expected: undefined,
    method: requestOtherGroup,
  },
  {
    args: {type: serviceTypeRegisterPendingOpen},
    description: 'A pending open from a nonmember is rejected after locking',
    expected: denied,
    method: requestNonmember,
  },
  {
    args: {type: serviceTypeRegisterSignedOpen},
    description: 'A signed open from a nonmember is rejected after locking',
    expected: denied,
    method: requestNonmember,
  },
];

tests.forEach(({args, description, expected, method}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
