const EventEmitter = require('node:events');

const {identity} = require('./group_members');
const parseRequestMessage = require('./../../../p2p/parse_request_message');

// Read a response message as hex
const bufferAsHex = buffer => buffer.toString('hex');
// Decode a public key from hex
const hexAsBuffer = hex => Buffer.from(hex, 'hex');

/** Make an LND stub that records peer responses

  @returns
  {
    lnd: <LND API Stub Object>
    replies: [<Decoded Peer Response Object>]
    subscription: <Peer Message Subscription Event Emitter Object>
  }
*/
module.exports = () => {
  const replies = [];
  const subscription = new EventEmitter();

  subscription.cancel = () => {};

  const lnd = {
    default: {
      SubscribeCustomMessages: () => subscription,
      listPermissions: ({}, cbk) => cbk(null, {
        method_permissions: {
          '/walletrpc.WalletKit/SignPsbt': {permissions: []},
        },
      }),
      sendCustomMessage: (args, cbk) => {
        const message = bufferAsHex(args.data);

        try {
          const reply = parseRequestMessage({message, type: args.type});

          replies.push(reply);

          return cbk();
        } catch (err) {
          return cbk(err);
        }
      },
      walletBalance: ({}, cbk) => cbk(null, {confirmed_balance: '1000000'}),
    },
    wallet: {
      deriveKey: ({}, cbk) => cbk(null, {
        key_loc: {key_index: 0},
        raw_key_bytes: hexAsBuffer(identity),
      }),
    },
  };

  return {lnd, replies, subscription};
};
