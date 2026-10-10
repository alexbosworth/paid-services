const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../support/related_menu_levels');

// Nest a number of related menus, the deepest with no related offers
const nest = levels => Array(levels).fill(null).reduce(related => {
  return [{related, offer: 'offer'}];
},
[]);

const tests = [
  {
    args: {},
    description: 'No related offers are within the most levels',
    expected: {is_within_max_depth: true},
  },
  {
    args: {related: [{offer: 'offer'}]},
    description: 'Related offers without menus are within the most levels',
    expected: {is_within_max_depth: true},
  },
  {
    args: {related: nest(4)},
    description: 'Related menus can be four levels deep',
    expected: {is_within_max_depth: true},
  },
  {
    args: {related: nest(5)},
    description: 'An empty related menu five levels deep is too deep',
    expected: {is_within_max_depth: false},
  },
  {
    args: {related: [{offer: 'offer', related: 'related'}]},
    description: 'Related offers that are not a list are not looked into',
    expected: {is_within_max_depth: true},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
