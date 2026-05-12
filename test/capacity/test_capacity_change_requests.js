const {deepStrictEqual, strictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const method = require('./../../capacity/capacity_change_requests');

const makeArgs = overrides => {
  const args = {
    channels: [{
      capacity: 1,
      id: '0x0x0',
      partner_public_key: Buffer.alloc(33, 3).toString('hex'),
    }],
    requests: [{
      channel: '0x0x0',
      from: Buffer.alloc(33, 3).toString('hex'),
      id: Buffer.alloc(32).toString('hex'),
    }],
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Map change requests to capacity change requests',
    expected: {
      requests: [{
        address: undefined,
        capacity: 1,
        channel: '0x0x0',
        decrease: undefined,
        from: Buffer.alloc(33, 3).toString('hex'),
        id: Buffer.alloc(32).toString('hex'),
        increase: undefined,
        to: undefined,
        type: undefined,
      }],
    },
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, () => {
    if (!!error) {
      throws(
        () => method(args),
        err => {
          strictEqual(err.message, error, 'Got error');

          return true;
        },
        'Got error'
      );
    } else {
      const res = method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
