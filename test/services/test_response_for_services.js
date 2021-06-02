const {test} = require('tap');

const method = require('./../../services/response_for_services');

const tests = [
  {
    args: {},
    description: 'Env vars are required',
    error: [400, 'ExpectedEnvironmentVarsToGetResponseForServices'],
  },
  {
    args: {env: {PAID_SERVICES_PROFILE_FOR_NODE: 'node'}},
    description: 'Get services list',
    expected: {
      response: {
        records: [{
          type: '0',
          value: '020470696e67030770726f66696c65',
        }],
      },
    },
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
