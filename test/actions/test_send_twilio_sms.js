const {test} = require('tap');

const method = require('./../../actions/send_twilio_sms');

const makeArgs = overrides => {
  const args = {
    account: 'account',
    fetch: () => new Promise(resolve => resolve({status: 200})),
    from: 'from',
    key: 'key',
    text: 'text',
    to: 'to',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({account: undefined}),
    description: 'An account id is required',
    error: [400, 'ExpectedAccountIdToSendTwilioSmsMessage'],
  },
  {
    args: makeArgs({fetch: undefined}),
    description: 'A fetch method is required',
    error: [400, 'ExpectedFetchMethodToSendTwilioSmsMessage'],
  },
  {
    args: makeArgs({from: undefined}),
    description: 'A from email is required',
    error: [400, 'ExpectedFromSmsNumberToSendTwilioSmsMessage'],
  },
  {
    args: makeArgs({key: undefined}),
    description: 'An auth key is required',
    error: [400, 'ExpectedAuthApiKeyToSendTwilioSmsMessage'],
  },
  {
    args: makeArgs({text: undefined}),
    description: 'A message is required',
    error: [400, 'ExpectedTextToSendInTwilioSmsMessage'],
  },
  {
    args: makeArgs({to: undefined}),
    description: 'A destination is required',
    error: [400, 'ExpectedToNumberToSendTwilioSmsMessage'],
  },
  {
    args: makeArgs({fetch: () => new Promise((n, reject) => reject('err'))}),
    description: 'An SMS is not sent',
    error: [500, 'UnexpectedErrorSendingSmsViaTwilio', {err: 'err'}],
  },
  {
    args: makeArgs({
      fetch: () => new Promise(resolve => resolve({status: 500}))
    }),
    description: 'An SMS is not sent due to unexpected status code',
    error: [503, 'UnexpectedTwilioSmsStatus', {code: 500}],
  },
  {
    args: makeArgs({}),
    description: 'An SMS is sent',
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
