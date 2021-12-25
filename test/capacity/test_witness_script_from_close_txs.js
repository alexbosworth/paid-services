const {test} = require('@alexbosworth/tap');

const method = require('./../../capacity/witness_script_from_close_txs');

const makeArgs = overrides => {
  const args = {
    closing_tx_id: '8c037c526683ac573903a8028e764b6aee1556d584c06f9a4287643774388ae9',
    transactions: [{
      block_id: undefined,
      confirmation_count: undefined,
      confirmation_height: undefined,
      created_at: '2021-12-25T03:33:28.000Z',
      description: '0:closechannel:shortchanid-112150186098688',
      fee: undefined,
      id: '8c037c526683ac573903a8028e764b6aee1556d584c06f9a4287643774388ae9',
      is_confirmed: false,
      is_outgoing: false,
      output_addresses: [],
      tokens: 0,
      transaction: '02000000000101b2841e16bd8db0e960ca5d861336cb21e2adb999c2b7ffd8ba68a92950215752000000000093bfcb80024a0100000000000022002063db12b145998af3bc5122d454ca37d5a4690b69626584ac3d2fdb225eea1490b2340f00000000002200200bdb542d1a67fbb991413a01530f5d430f43a082e27efe11657fbf76a1734a0c0400483045022100c0ce0fab8d4c6e3f3a46035c80a3567a801de32cb0c69fff8c18e3e6a03a66c0022018881a1b79957fd1d201ee5696ad535a4a70d8f8addd1bcec6c65e21bb7c4c8f01473044022015ab404487a28dce1975b132377a112181a0a8d6564d0b01be07506808c571a302204cf66d2de2a5c499fd2f23d00c4dc8642d133b321c99dcade227ac8291671ffc0147522102404943cc648419553e1fa33e7b620c07cb1b7225a9437dfa849bb0b842e12f1121038af0a2a3cd6ca9bc1bd38e4a6fa005a7c92b3ddd9b0d4c2c816efa10cdcdadf652ae9d84ef20',
    }],
    transaction_id: '5257215029a968bad8ffb7c299b9ade221cb3613865dca60e9b08dbd161e84b2',
    transaction_vout: 0,
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({}),
    description: 'Get the witness script from a list of close transactions',
    expected: {
      script: '522102404943cc648419553e1fa33e7b620c07cb1b7225a9437dfa849bb0b842e12f1121038af0a2a3cd6ca9bc1bd38e4a6fa005a7c92b3ddd9b0d4c2c816efa10cdcdadf652ae',
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
