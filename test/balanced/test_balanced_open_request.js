const {test} = require('@alexbosworth/tap');

const method = require('./../../balanced/balanced_open_request');

const makeMessages = overrides => {
  const args = {
    '80501': Buffer.from('lntb10n1p3p6msgpp5s3xkaa2gg8q2zgmva8k9ruh3r7falxqdmkadac06wxc8fkqu4x0qdqqcqzpgxqr23ssp5ukm2dcl8wzfztx63758gmdjkna8jycypey880lenh082060fem4s9qyyssqul9nlwtpxqs2qegvpl9amltr4d9d8k9e008gr5ymv4aqkerel7dknusv60gtedgfvl3pq5lzg6c4sk4xf7lmlqtwr97cx047hpj9zqcp3mqur9').toString('hex'),
    '80502': (2e6).toString(16),
    '80504': (255).toString(16),
    '80505': Buffer.alloc(33, 2).toString('hex'),
    '80507': Buffer.alloc(32).toString('hex'),
    '80508': (255).toString(16),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  const messages = Object.keys(args)
    .filter(type => args[type] !== undefined)
    .map(type => ({type, value: args[type]}));

  return messages;
};

const makeArgs = overrides => {
  const args = {
    confirmed_at: new Date(0).toISOString(),
    is_push: true,
    payments: [{messages: makeMessages({})}],
    received_mtokens: '10000',
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({is_push: false}),
    description: 'A balanced open is a push',
    expected: {},
  },
  {
    args: makeArgs({received_mtokens: '10'}),
    description: 'A balanced open receives 10 sats',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80501': undefined})}],
    }),
    description: 'A balanced open has a reply request',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80501': 'invalid request'})}],
    }),
    description: 'A balanced open has a valid reply request',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{
        messages: makeMessages({
          '80501': Buffer.from('lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql').toString('hex'),
        }),
      }],
    }),
    description: 'A balanced open has a reply request with the correct amount',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80502': undefined})}],
    }),
    description: 'A balanced open has capacity',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{
        messages: makeMessages({'80502': Buffer.alloc(32).toString('hex')}),
      }],
    }),
    description: 'A balanced open has numeric capacity',
    expected: {},
  },
  {
    args: makeArgs({payments: [{messages: makeMessages({'80502': '01'})}]}),
    description: 'A balanced open has even capacity',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80504': undefined})}],
    }),
    description: 'A balanced open has a fee rate',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{
        messages: makeMessages({'80504': Buffer.alloc(32).toString('hex')}),
      }],
    }),
    description: 'A balanced open has a numeric fee rate',
    expected: {},
  },
  {
    args: makeArgs({payments: [{messages: makeMessages({'80504': '00'})}]}),
    description: 'A balanced open has non zero fee rate',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80505': undefined})}],
    }),
    description: 'A balanced open has a remote multisig key',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80505': Buffer.alloc(32)})}],
    }),
    description: 'A balanced open has a remote multisig public key',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80507': undefined})}],
    }),
    description: 'A balanced open has a tx id',
    expected: {},
  },
  {
    args: makeArgs({payments: [{messages: makeMessages({'80507': '00'})}]}),
    description: 'A balanced open has a regular sized tx id',
    expected: {},
  },
  {
    args: makeArgs({
      payments: [{messages: makeMessages({'80508': undefined})}],
    }),
    description: 'A balanced open has a tx vout',
    expected: {},
  },
  {
    args: makeArgs({}),
    description: 'Derive a balanced open request',
    expected: {
      accept_request: 'lntb10n1p3p6msgpp5s3xkaa2gg8q2zgmva8k9ruh3r7falxqdmkadac06wxc8fkqu4x0qdqqcqzpgxqr23ssp5ukm2dcl8wzfztx63758gmdjkna8jycypey880lenh082060fem4s9qyyssqul9nlwtpxqs2qegvpl9amltr4d9d8k9e008gr5ymv4aqkerel7dknusv60gtedgfvl3pq5lzg6c4sk4xf7lmlqtwr97cx047hpj9zqcp3mqur9',
      capacity: 2000000,
      fee_rate: 255,
      partner_public_key: '020ec0c6a0c4fe5d8a79928ead294c36234a76f6e0dca896c35413612a3fd8dbf8',
      proposed_at: '1970-01-01T00:00:00.000Z',
      remote_multisig_key: '020202020202020202020202020202020202020202020202020202020202020202',
      remote_tx_id: '0000000000000000000000000000000000000000000000000000000000000000',
      remote_tx_vout: 255,
    },
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
