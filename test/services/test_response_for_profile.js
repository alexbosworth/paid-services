const {test} = require('@alexbosworth/tap');

const method = require('./../../services/response_for_profile');

const tests = [
  {
    args: {},
    description: 'Environment variables are expected',
    error: [400, 'ServerConfMissingForNodeProfileResponse'],
  },
  {
    args: {env: {}},
    description: 'No profile',
    error: [404, 'ServiceCurrentlyUnsupported'],
  },
  {
    args: {env: {PAID_SERVICES_PROFILE_FOR_NODE: 'node'}},
    description: 'Service is enabled',
    expected: {response: {text: 'node'}},
  },
  {
    args: {env: {PAID_SERVICES_PROFILE_URLS: 'http://example.com'}},
    description: 'Service is enabled with a URL',
    expected: {response: {links: ['http://example.com'], text: undefined}},
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
