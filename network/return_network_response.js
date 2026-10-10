const asyncAuto = require('async/auto');
const {onionForPath} = require('bolt04');
const {returnResult} = require('asyncjs-util');
const {sendMessage} = require('ln-service');

const getPathOutbound = require('./get_path_outbound');

const errorTooLarge = 'ExpectedHopPayloadsToFitWithinMaximumOnionPacketSize';
const isLargeOnion = onion => !!onion && onion.length / 2 === largeOnionBytes;
const isTooLarge = err => !!err && err.message === errorTooLarge;
const largeOnionBytes = 32834;

/** Send a response to a network request back through its reply path

  With `is_regular`, the response is only sent when it fits in an onion
  message of the regular size. Otherwise it has to fit in a large one. A
  response that does not fit is a 413 error. Give the `outbound` hops to the
  reply path when they are known.

  {
    [is_regular]: <Only Send In An Onion Message Of The Regular Size Bool>
    lnd: <Authenticated LND API Object>
    message: {
      type: <Message Payload Record Type Number String>
      value: <Message Payload Hex String>
    }
    reply: {
      inbound: [{
        encrypted_data: <Encrypted Data Hex String>
        relay_key: <Blinded Relay Key Hex String>
      }]
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
      key: <Path Key Hex String>
    }
    [outbound]: [<Relaying Node Public Key Hex String>]
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToReturnNetworkResponse']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToReturnNetworkResponse']);
        }

        if (!args.reply) {
          return cbk([400, 'ExpectedReplyPathToReturnNetworkResponse']);
        }

        return cbk();
      },

      // Determine the outbound hops to reach the reply path
      getOutbound: ['validate', ({}, cbk) => {
        // Exit early when the outbound hops are already known
        if (!!args.outbound) {
          return cbk(null, {outbound: args.outbound});
        }

        return getPathOutbound({lnd: args.lnd, path: args.reply}, cbk);
      }],

      // Check that the response fits in an onion message that can be sent
      checkSize: ['getOutbound', ({getOutbound}, cbk) => {
        try {
          const {onion} = onionForPath({
            inbound: args.reply.inbound,
            key: args.reply.key,
            outbound: getOutbound.outbound,
            records: [args.message],
          });

          // Exit early when the response can be in a large onion message
          if (!args.is_regular) {
            return cbk();
          }

          if (isLargeOnion(onion)) {
            return cbk([413, 'ExpectedResponseThatFitsRegularOnionMessage']);
          }

          return cbk();
        } catch (err) {
          // Exit early when the response does not fit in any onion message
          if (isTooLarge(err)) {
            return cbk([413, 'ExpectedResponseThatFitsLargeOnionMessage']);
          }

          return cbk([400, 'FailedToEncodeResponseOnionMessage', {err}]);
        }
      }],

      // Send the response message through the reply path
      send: ['checkSize', 'getOutbound', ({getOutbound}, cbk) => {
        return sendMessage({
          inbound: args.reply.inbound,
          key: args.reply.key,
          lnd: args.lnd,
          message: args.message,
          outbound: getOutbound.outbound,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
