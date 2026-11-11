const EventEmitter = require('node:events');
const {createHash} = require('node:crypto');
const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const {chanNumber} = require('bolt07');
const {createSignedRequest} = require('invoices');
const {createUnsignedRequest} = require('invoices');
const {diffieHellmanComputeSecret} = require('ln-service');
const {getIdentity} = require('ln-service');
const {makeInvoice} = require('mock-lnd');
const {makeLnd} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');
const {sign} = require('tiny-secp256k1');

const encodeOffToOnResponse =
  require('./../../swaps/encode_off_to_on_response');
const method = require('./../../swaps/complete_on_to_off_swap');
const {typePayMetadata} = require('./../../swaps/swap_field_types');

const bufferAsHex = buffer => Buffer.from(buffer).toString('hex');
const fundingError = {details: 'failed to fund'};
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const key = n => Buffer.alloc(32, n);
const nextTick = () => new Promise(resolve => setImmediate(resolve));
const sha256 = hex => createHash('sha256').update(hex, 'hex').digest('hex');
const timeout = 101;
const tokens = 100000;

// The public key of a private key that is 32 bytes of a number
const publicKey = n => {
  const privateKey = key(n);

  return bufferAsHex(pointFromScalar(privateKey));
};

// A payment request from the node that runs the swap
const makeRequest = ({id, mtokens}) => {
  const {hash, hrp, tags} = createUnsignedRequest({
    id,
    mtokens,
    cltv_delta: 40,
    created_at: '2024-01-01T00:00:00.000Z',
    description: 'swap',
    expires_at: '2100-01-01T00:00:00.000Z',
    network: 'regtest',
    payment: bufferAsHex(key(4)),
  });

  return createSignedRequest({
    hrp,
    tags,
    destination: publicKey(1),
    signature: bufferAsHex(sign(hexAsBuffer(hash), key(1))),
  });
};

// Complete a swap that is encrypted to the node, when held funds come in on a
// channel, and get the held invoices that are canceled and the error that the
// swap fails with, which is a funding error when the funds are accepted
const completeSwap = async args => {
  const canceled = [];
  const claimCoopPublicKey = publicKey(3);
  const coopKeyHash = sha256(publicKey(3));
  const depositId = sha256(bufferAsHex(key(5)));
  const peer = publicKey(7);
  const stream = new EventEmitter();
  const swapHash = sha256(bufferAsHex(key(2)));

  const lnd = makeLnd({
    channels: [{id: '1x2x3', other_ids: ['4x5x6'], partner_public_key: peer}],
    fundPsbt: ({}, cbk) => cbk(fundingError),
    network: 'regtest',
    subscribeToInvoice: stream,
  });

  const metadata = {type: typePayMetadata, value: claimCoopPublicKey};
  const names = {[depositId]: 'deposit', [swapHash]: 'swap'};

  stream.cancel = () => {};

  // Sweeps go to a taproot address
  lnd.default.newAddress = ({}, cbk) => cbk(null, {address: 'address'});

  lnd.wallet.listAccounts = ({}, cbk) => {
    return cbk(null, {accounts: [{address_type: 'TAPROOT_PUBKEY'}]});
  };

  lnd.invoices.cancelInvoice = (request, cbk) => {
    canceled.push(names[bufferAsHex(request.payment_hash)]);

    return cbk(null, {});
  };

  const identity = await getIdentity({lnd});

  const {secret} = await diffieHellmanComputeSecret({
    lnd,
    partner_public_key: identity.public_key,
  });

  const {recovery} = encodeOffToOnResponse({
    timeout,
    tokens,
    claim_public_key: publicKey(6),
    coop_private_key: bufferAsHex(key(5)),
    coop_public_key: publicKey(5),
    coop_public_key_hash: coopKeyHash,
    deposit: makeRequest({id: depositId, mtokens: '1000000'}).request,
    encrypt: secret,
    hash: swapHash,
    incoming_peer: !args.is_peer_constrained ? undefined : peer,
    key_index: 0,
    push: makeRequest({id: coopKeyHash, mtokens: '1000'}).request,
    refund_public_key: publicKey(8),
    request: makeRequest({id: swapHash, mtokens: '100100000'}).request,
    solo_private_key: bufferAsHex(key(8)),
  });

  // The deposit and the funding are both held, paid in over the channel
  const held = makeInvoice({payments: [{messages: [metadata]}]});

  held.htlcs.forEach(htlc => {
    htlc.chan_id = chanNumber({channel: args.channel}).number;
    htlc.expiry_height = timeout + 100;
  });

  const swap = method({lnd, recovery, emitter: new EventEmitter()});

  // Wait for the swap to listen for the deposit and the funding
  while (stream.listenerCount('data') < [depositId, swapHash].length) {
    await nextTick();
  }

  stream.emit('data', held);

  const error = await swap.then(() => null, err => err);

  return {canceled, error};
};

const tests = [
  {
    args: {channel: '9x9x9', is_peer_constrained: true},
    description: 'Funds paid in through another peer are refused and released',
    expected: {
      canceled: ['deposit', 'swap'],
      error: [503, 'UnexpectedInboundChannelForHeldDeposit'],
    },
  },
  {
    args: {channel: '1x2x3', is_peer_constrained: true},
    description: 'Funds paid in through the peer are accepted',
    expected: {
      canceled: [],
      error: [503, 'UnexpectedErrorFundingTransaction', {err: fundingError}],
    },
  },
  {
    args: {channel: '4x5x6', is_peer_constrained: true},
    description: 'Funds paid in through a peer channel alias are accepted',
    expected: {
      canceled: [],
      error: [503, 'UnexpectedErrorFundingTransaction', {err: fundingError}],
    },
  },
  {
    args: {channel: '9x9x9'},
    description: 'Funds can come in through any peer without a constraint',
    expected: {
      canceled: [],
      error: [503, 'UnexpectedErrorFundingTransaction', {err: fundingError}],
    },
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, async () => {
    deepStrictEqual(await completeSwap(args), expected, 'Got expected result');
  });
});
