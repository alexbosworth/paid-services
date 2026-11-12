const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {member} = require('./fixtures/group_members');
const method = require('./fixtures/group_log_completion');

const error = 'UnexpectedErrorAssemblingChannelGroup';
const expected = {error, callbacks: 1, early_callbacks: 0};

const tests = [
  {
    args: {ids: ['invalid']},
    description: 'Alias lookup failures do not complete group creation',
    expected: {...expected, ready: 0},
  },
  {
    args: {ids: [member]},
    description: 'Logging member aliases does not complete group creation',
    expected: {...expected, ready: 1},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, async () => {
    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
