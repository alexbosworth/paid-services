const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../support/unpaid_invoices');

const tests = [
  {
    args: {max: 2, ms: 1000},
    description: 'Unpaid invoices are limited within the window',
    expected: [true, true, false],
    steps: [
      ['take', {key: 'a', now: 0}],
      ['take', {key: 'b', now: 1}],
      ['take', {key: 'c', now: 2}],
    ],
  },
  {
    args: {max: 1, ms: 1000},
    description: 'A paid invoice frees its slot',
    expected: [true, undefined, true],
    steps: [
      ['take', {key: 'a', now: 0}],
      ['free', {key: 'a'}],
      ['take', {key: 'b', now: 1}],
    ],
  },
  {
    args: {max: 1, ms: 1000},
    description: 'Invoices made before the window no longer count',
    expected: [true, false, true],
    steps: [
      ['take', {key: 'a', now: 0}],
      ['take', {key: 'b', now: 999}],
      ['take', {key: 'b', now: 1000}],
    ],
  },
];

tests.forEach(({args, description, expected, steps}) => {
  test(description, () => {
    const unpaid = method(args);

    const results = steps.map(([fn, step]) => unpaid[fn](step));

    deepStrictEqual(results, expected, 'Got expected result');
  });
});
