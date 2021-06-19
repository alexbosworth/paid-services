const {encodeTlvStream} = require('bolt01');
const {makeInvoice} = require('mock-lnd');
const {makeInvoiceSubscription} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {makePaySubscription} = require('mock-lnd');
const {makePaymentRequest} = require('mock-lnd');
const {test} = require('@alexbosworth/tap');

const messagesForResponse = require('./../../respond/messages_for_response');
const method = require('./../../client/make_service_request');
const responseForSchema = require('./../../services/response_for_schema');

const encode = records => encodeTlvStream({records: [records]}).encoded;
const id1 = Buffer.alloc(32).toString('hex');
const id2 = Buffer.alloc(32, 1).toString('hex');
const {request} = makePaymentRequest({});

const makeArgs = overrides => {
  let requests = 0;

  const lnd = makeLnd({
    subscribeToInvoice: makeInvoiceSubscription({
      invoice: makeInvoice({
        is_confirmed: true,
        is_push: true,
        payments: [{
          is_confirmed: true,
          messages: messagesForResponse({
            records: [
              {type: '1', value: '04'},
              {type: '2', value: Buffer.from('description').toString('hex')},
            ],
          }).messages,
        }],
      }),
    }),
  });

  lnd.default.getInfo = ({}, cbk) => {
    return cbk(null, {
      alias: '',
      best_header_timestamp: 1,
      block_hash: Buffer.alloc(32).toString('hex'),
      block_height: 1,
      chains: [{chain: 'bitcoin', network: 'mainnet'}],
      color: '#000000',
      features: {'1': {is_known: true, is_required: false}},
      identity_pubkey: '020000000000000000000000000000000000000000000000000000000000000000',
      num_active_channels: 0,
      num_peers: 0,
      num_pending_channels: 0,
      synced_to_chain: false,
      uris: [],
      version: '',
    });
  };

  lnd.default.queryRoutes = ({}, cbk) => {
    return cbk(null, {
      routes: [{
        hops: [{
          amt_to_forward_msat: '1',
          chan_capacity: '1',
          chan_id: '1',
          custom_records: {},
          expiry: 1,
          fee_msat: '1',
          pub_key: Buffer.alloc(33, 3).toString('hex'),
        }],
        total_amt: 1,
        total_amt_msat: '1',
        total_fees: '1',
        total_fees_msat: '1',
        total_time_lock: 1,
      }],
      success_prob: 1,
    });
  };

  lnd.chain = {
    registerBlockEpochNtfn: ({}) => {
      const emitter = new EventEmitter();

      emitter.cancel = () => {};

      process.nextTick(() => emitter.emit('error', 'err'));

      return emitter;
    },
  };

  lnd.router = {
    sendToRoute: (args, cbk) => {
      requests++;

      if (requests === 2) {
        return cbk(null, {preimage: Buffer.alloc(32)});
      }

      return cbk(null, {
        failure: {
          chan_id: '1',
          code: 'UNKNOWN_FAILURE',
          failure_source_index: 1,
        },
        preimage: Buffer.alloc(Number()),
      });
    },
  };

  const args = {
    lnd,
    id: Buffer.alloc(32).toString('hex'),
    ms: 1000,
    network: 'btc',
    node: Buffer.alloc(33, 3).toString('hex'),
  };

  Object.keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

const tests = [
  {
    args: makeArgs({id: undefined}),
    description: 'Waiting for a response requires a service id',
    error: [400, 'ExpectedServiceIdNumberToMakeServiceRequest'],
  },
  {
    args: makeArgs({}),
    description: 'The response is returned',
    expected: {
      links: undefined,
      nodes: undefined,
      paywall: undefined,
      records: [
        {type: '1', value: '04'},
        {type: '2', value: '6465736372697074696f6e'},
      ],
      text: undefined,
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
