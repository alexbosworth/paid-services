const {test} = require('@alexbosworth/tap');

const method = require('./../../p2p/encode_peer_request');

const makeArgs = overrides => {
  const args = {id: '00', type: '0'};

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'A request id is required',
    error: 'ExpectedRequestIdHexStringToEncodePeerRequest',
  },
  {
    args: makeArgs({records: '00'}),
    description: 'Records array is required',
    error: 'ExpectedRecordsArrayToEncodePeerRequest',
  },
  {
    args: makeArgs({type: undefined}),
    description: 'A type is required',
    error: 'ExpectedRequestTypeToEncodePeerRequest',
  },
  {
    args: makeArgs({}),
    description: 'Peer request is encoded',
    expected: {message: '626f73ff010100030100'},
  },
  {
    args: makeArgs({records: [{type: '0', value: '00'}]}),
    description: 'Peer request with records is encoded',
    expected: {message: '626f73ff0101000301000503000100'},
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
