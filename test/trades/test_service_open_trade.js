const EventEmitter = require('node:events');
const {deepStrictEqual} = require('node:assert/strict');
const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {makeLnd} = require('mock-lnd');

const serviceOpenTrade = require('./../../trades/service_open_trade');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const futureDate = ms => new Date(Date.now() + ms).toISOString();
const {keys} = Object;
const {nextTick} = process;
const publicKey = Buffer.alloc(33, 2).toString('hex');

// LND with a peer messages subscription that fails, which ends the service
const makeLndWithFailingPeerMessages = () => {
  const lnd = makeLnd({});

  // Peer messages are subscribed to with the gRPC name of the method
  lnd.default.SubscribeCustomMessages = ({}) => {
    const stream = new EventEmitter();

    stream.cancel = () => {};

    nextTick(() => stream.emit('error', {details: 'failure'}));

    return stream;
  };

  return lnd;
};

// Make arguments to service a trade, with overrides
const makeArgs = overrides => {
  const args = {
    channels: [],
    description: 'description',
    expires_at: futureDate(1000 * 60),
    id: Buffer.alloc(32).toString('hex'),
    lnd: makeLndWithFailingPeerMessages(),
    logger: {error: () => {}, info: () => {}},
    network: 'btc',
    public_key: publicKey,
    request: () => {},
    secret: 'secret',
    tokens: 1,
    uris: [`${publicKey}@127.0.0.1:9735`],
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Service a trade that ends without a settlement, and get the callbacks of
// the service, what it logged last, and the rejections that were unhandled
const endWithoutSettlement = async ({}) => {
  const calls = [];
  const logs = [];
  const unhandled = [];

  const onUnhandled = err => unhandled.push(err.message);

  process.on('unhandledRejection', onUnhandled);

  await new Promise(resolve => {
    const logger = {error: () => {}, info: n => logs.push(n)};

    return serviceOpenTrade(makeArgs({logger}), err => {
      calls.push(err);

      return resolve();
    });
  });

  // Give a second callback the chance to happen
  await delay(50);

  process.removeListener('unhandledRejection', onUnhandled);

  return {
    unhandled,
    calls: calls.length,
    errors: calls.filter(err => !!err),
    log: logs.pop(),
  };
};

const tests = [
  {
    args: makeArgs({secret: undefined}),
    description: 'A secret or channel to sell is expected',
    error: [400, 'ExpectedSecretOrChannelToSellToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({channels: undefined}),
    description: 'Channels are expected',
    error: [400, 'ExpectedArrayOfChannelsToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({description: undefined}),
    description: 'A description or channel is expected',
    error: [400, 'ExpectedChannelOrDescriptionToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({expires_at: undefined}),
    description: 'An expiry date is expected',
    error: [400, 'ExpectedExpiresAtDateToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({id: undefined}),
    description: 'A trade anchor id is expected',
    error: [400, 'ExpectedTradeAnchorIdToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is expected',
    error: [400, 'ExpectedWinstonLoggerToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({network: undefined}),
    description: 'A network name is expected',
    error: [400, 'ExpectedNetworkNameToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({tokens: undefined}),
    description: 'A price is expected',
    error: [400, 'ExpectedTokensOrPriceExpressionToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({public_key: undefined}),
    description: 'An identity public key is expected',
    error: [400, 'ExpectedIdentityPublicKeyToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({request: undefined}),
    description: 'A request function is expected',
    error: [400, 'ExpectedRequestFunctionToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: makeArgs({uris: undefined}),
    description: 'Node URIs are expected',
    error: [400, 'ExpectedArrayOfNodeSocketUrisToServiceTrade'],
    method: serviceOpenTrade,
  },
  {
    args: {},
    description: 'A trade that ends without a settlement calls back once',
    expected: {calls: 1, errors: [], log: {trade_ended: true}, unhandled: []},
    method: endWithoutSettlement,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, async () => {
    if (!!error) {
      await rejects(
        method(args),
        err => {
          deepStrictEqual(err, error, 'Got expected error');

          return true;
        },
        'Got expected error'
      );
    } else {
      const res = await method(args);

      deepStrictEqual(res, expected, 'Got expected result');
    }
  });
});
