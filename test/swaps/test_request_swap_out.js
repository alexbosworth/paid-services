const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const {rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {createSignedRequest} = require('invoices');
const {createUnsignedRequest} = require('invoices');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');
const {sign} = require('tiny-secp256k1');

const encodeOffToOnRequest = require('./../../swaps/encode_off_to_on_request');
const encodeOffToOnResponse =
  require('./../../swaps/encode_off_to_on_response');
const requestSwapOut = require('./../../swaps/request_swap_out');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const key = n => Buffer.alloc(32, n);
const {keys} = Object;
const sha256 = hex => createHash('sha256').update(hex, 'hex').digest('hex');
const tokens = 100000;

// The public key of a private key that is 32 bytes of a number
const publicKey = n => {
  const privateKey = key(n);

  return bufferAsHex(pointFromScalar(privateKey));
};

// A payment request from the swap service
const makeRequest = ({id, mtokens}) => {
  const {hash, hrp, tags} = createUnsignedRequest({
    id,
    mtokens,
    cltv_delta: 40,
    created_at: '2024-01-01T00:00:00.000Z',
    description: 'swap',
    expires_at: '2100-01-01T00:00:00.000Z',
    network: 'testnet',
    payment: bufferAsHex(key(4)),
  });

  return createSignedRequest({
    hrp,
    tags,
    destination: publicKey(1),
    signature: bufferAsHex(sign(hexAsBuffer(hash), key(1))),
  });
};

// A swap out request, and the response of the swap service that asks for the
// swap to be paid in through an inbound peer
const makeSwap = () => {
  const coopKeyHash = sha256(publicKey(3));
  const hash = sha256(bufferAsHex(key(2)));

  const swap = encodeOffToOnRequest({
    hash,
    tokens,
    coop_private_key: bufferAsHex(key(3)),
    coop_public_key_hash: coopKeyHash,
    encrypt: bufferAsHex(key(9)),
    key_index: 0,
    public_key: publicKey(6),
    secret: bufferAsHex(key(2)),
  });

  const {response} = encodeOffToOnResponse({
    hash,
    tokens,
    claim_public_key: publicKey(6),
    coop_private_key: bufferAsHex(key(5)),
    coop_public_key: publicKey(5),
    coop_public_key_hash: coopKeyHash,
    deposit: makeRequest({
      id: sha256(bufferAsHex(key(5))),
      mtokens: '1000000',
    }).request,
    encrypt: bufferAsHex(key(8)),
    incoming_peer: publicKey(7),
    key_index: 0,
    push: makeRequest({id: coopKeyHash, mtokens: '1000'}).request,
    refund_public_key: publicKey(10),
    request: makeRequest({id: hash, mtokens: '100100000'}).request,
    timeout: 500,
  });

  return {response, recovery: swap.recovery, request: swap.request};
};

// Make arguments to request a swap out, with overrides
const makeArgs = overrides => {
  const swap = makeSwap();

  const args = {
    ask: (question, cbk) => cbk({[question.name]: false}),
    is_external_funding: true,
    lnd: makeLnd({network: 'testnet'}),
    logger: {error: () => {}, info: () => {}},
    swap_recovery: swap.recovery,
    swap_request: swap.request,
    swap_response: swap.response,
  };

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

// Request an externally funded swap out that is declined, and get the error
// and if the question that was asked shows the inbound peer
const askedQuestion = async ({}) => {
  const messages = [];

  const ask = (question, cbk) => {
    messages.push(question.message);

    return cbk({[question.name]: false});
  };

  const error = await requestSwapOut(makeArgs({ask})).then(() => null, n => n);

  const [message] = messages;

  return {error, is_peer_shown: message.endsWith(` in via ${publicKey(7)}?`)};
};

const tests = [
  {
    args: makeArgs({ask: undefined}),
    description: 'An ask function is expected',
    error: [400, 'ExpectedAskFunctionToRequestSwapOut'],
    method: requestSwapOut,
  },
  {
    args: makeArgs({lnd: undefined}),
    description: 'LND is expected',
    error: [400, 'ExpectedAuthenticatedLndToRequestSwapOut'],
    method: requestSwapOut,
  },
  {
    args: makeArgs({logger: undefined}),
    description: 'A logger is expected',
    error: [400, 'ExpectedWinstonLoggerToRequestSwapOut'],
    method: requestSwapOut,
  },
  {
    args: makeArgs({}),
    description: 'A declined swap is canceled',
    error: [400, 'SwapCanceled'],
    method: requestSwapOut,
  },
  {
    args: {},
    description: 'The inbound peer of an externally funded swap is shown',
    expected: {error: [400, 'SwapCanceled'], is_peer_shown: true},
    method: askedQuestion,
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
