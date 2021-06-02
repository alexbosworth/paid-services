const {test} = require('tap');

const method = require('./../../actions/send_postmark_email');

const makeArgs = overrides => {
  const args = {
    fetch: () => new Promise(resolve => resolve()),
    from: 'from',
    key: 'key',
    subject: 'subject',
    text: 'text',
    to: 'to',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch method is required',
    error: [400, 'ExpectedFetchFunctionToSendPostmarkEmail'],
  },
  {
    args: makeArgs({from: undefined}),
    description: 'A from email is required',
    error: [400, 'ExpectedFromEmailToSendPostmarkEmail'],
  },
  {
    args: makeArgs({key: undefined}),
    description: 'A postmark auth key is required',
    error: [400, 'ExpectedPostmarkApiKeyToSendEmail'],
  },
  {
    args: makeArgs({subject: undefined}),
    description: 'An email subject line is required',
    error: [400, 'ExpectedSubjectToSendEmail'],
  },
  {
    args: makeArgs({text: undefined}),
    description: 'An email body is required',
    error: [400, 'ExpectedTextToSendPostmarkEmail'],
  },
  {
    args: makeArgs({to: undefined}),
    description: 'A destination email is required',
    error: [400, 'ExpectedToAddressToSendPostmarkEmail'],
  },
  {
    args: makeArgs({fetch: () => new Promise((n, reject) => reject('err'))}),
    description: 'A postmark email is not sent',
    error: [500, 'UnexpectedErrorPostingEmailToPostmark', {err: 'err'}],
  },
  {
    args: makeArgs({}),
    description: 'A postmark email is sent',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, rejects}) => {
    if (!!error) {
      await rejects(method(args), error, 'Got error');
    } else {
      const res = await method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
