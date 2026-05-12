const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../services/response_for_pong');

const tests = [
  {
    args: {},
    description: 'Service returns pong',
    expected: {response: {text: 'Pong!'}},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, async () => {
    const res = await method(args);

    deepStrictEqual(res, expected, 'Got expected result');
  });
});
