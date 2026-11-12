const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {member} = require('./fixtures/group_members');
const method = require('./fixtures/join_created_group');
const {other} = require('./fixtures/group_members');

const invalid = [400, 'ExpectedArrayOfGroupMembersToCreateChannelGroup'];
const unrestricted = {failure: undefined};

const tests = [
  {
    args: {},
    description: 'Omitting members creates an unrestricted channel group',
    expected: unrestricted,
  },
  {
    args: {members: undefined},
    description: 'Undefined members creates an unrestricted channel group',
    expected: unrestricted,
  },
  {
    args: {members: []},
    description: 'Empty members creates an unrestricted channel group',
    expected: unrestricted,
  },
  {
    args: {members: [member, other]},
    description: 'Specified members still restrict channel group membership',
    expected: {failure: [403, 'AccessDeniedToGroup']},
  },
  {
    args: {members: null},
    description: 'Null members is rejected',
    expected: {error: invalid},
  },
  {
    args: {members: member},
    description: 'Members must be an array when specified',
    expected: {error: invalid},
  },
  {
    args: {members: [member]},
    description: 'Specified members must contain every other group member',
    expected: {error: [400, 'ExpectedCompleteSetOfAllowedGroupMembers']},
  },
  {
    args: {members: [member, 'invalid']},
    description: 'Specified members must be node public keys',
    expected: {error: [400, 'ExpectedNodeIdentityPublicKeysForChannelGroup']},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, async () => {
    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
