const {test} = require('@alexbosworth/tap');

const method = require('./../../p2p/encode_peer_response');

const makeArgs = overrides => {
  const args = {id: '00'};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Peer response is encoded',
    expected: {message: '626f73ff01010002030001c8'},
  },
  {
    args: makeArgs({records: [{type: '0', value: '00'}]}),
    description: 'Peer response with records is encoded',
    expected: {message: '626f73ff01010002030001c80503000100'},
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, async ({end, strictSame, throws}) => {
    if (!!error) {
      throws(() => method(args), new Error(error), 'Got error');
    } else {
      const res = method(args);

      strictSame(res, expected, 'Got expected result');
    }

    return end();
  });
});
