const {test} = require('@alexbosworth/tap');

const method = require('./../../services/response_for_pong');

const tests = [
  {
    args: {},
    description: 'Service returns pong',
    expected: {response: {text: 'Pong!'}},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, equal, rejects, strictSame}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got expected error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
