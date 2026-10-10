const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../support/shared_result');

// Start a task, ask for its result before and after it is done, finish it
// twice, and count how many times it was started
const run = ({err, res}) => {
  const results = [];

  let finish;
  let starts = 0;

  const {get} = method({
    start: cbk => {
      starts++;

      finish = cbk;
    },
  });

  get((...result) => results.push(result));
  get((...result) => results.push(result));

  finish(err, res);
  finish(err, 'again');

  get((...result) => results.push(result));

  return {results, starts};
};

const tests = [
  {
    args: {res: 'result'},
    description: 'A result is given to each callback',
    expected: {
      results: [
        [undefined, 'result'],
        [undefined, 'result'],
        [undefined, 'result'],
      ],
      starts: 1,
    },
  },
  {
    args: {err: 'failed'},
    description: 'An error is given to each callback',
    expected: {
      results: [
        ['failed', undefined],
        ['failed', undefined],
        ['failed', undefined],
      ],
      starts: 1,
    },
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(run(args), expected, 'Got expected result');
  });
});
