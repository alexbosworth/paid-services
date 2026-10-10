const asyncAuto = require('async/auto');
const {getIdentity} = require('ln-service');
const {returnResult} = require('asyncjs-util');
const {sendMessage} = require('ln-service');
const {subscribeToMessages} = require('ln-service');

const getPathId = require('./get_path_id');
const getPathOutbound = require('./get_path_outbound');

const defaultTimeoutMs = 1000 * 30;
const {isArray} = Array;
const isPublicKey = n => typeof n === 'string' && /^[0-9A-F]{66}$/i.test(n);
const {isSafeInteger} = Number;
const isTimeout = n => isSafeInteger(n) && n > 0;

/** Send an onion message over a blinded path and wait for its reply

  The reply is the first message of one of the reply `types` that arrives on
  the reply path of the message, which starts at self or at a connected
  `introduction` peer. The request fails when no reply arrives within the
  `timeout`.

  {
    [introduction]: <Reply Path Introduction Peer Public Key Hex String>
    lnd: <Authenticated LND API Object>
    message: {
      type: <Message Payload Record Type Number String>
      value: <Message Payload Hex String>
    }
    path: {
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
    }
    [timeout]: <Reply Timeout Milliseconds Number> // Default: 30000
    types: [<Reply Message Payload Record Type Number String>]
  }

  @throws error via cbk or Promise
  [0, NetworkRequestTimeout]
  [501, ExpectedLndSupportingOnionMessagesToRequestNetworkReply]

  @returns via cbk or Promise
  {
    reply: {
      type: <Reply Message Payload Record Type Number String>
      value: <Reply Message Payload Hex String>
    }
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToRequestNetworkReply']);
        }

        if (!args.message) {
          return cbk([400, 'ExpectedMessageToRequestNetworkReply']);
        }

        if (!args.path || !isArray(args.path.hops) || !args.path.key) {
          return cbk([400, 'ExpectedBlindedPathToRequestNetworkReply']);
        }

        if (!args.path.hops.length) {
          return cbk([400, 'ExpectedBlindedPathToRequestNetworkReply']);
        }

        if (!args.path.introduction_edge && !args.path.introduction_node) {
          return cbk([400, 'ExpectedPathIntroductionToRequestNetworkReply']);
        }

        // A node introduction is looked up as a public key
        if (!!args.path.introduction_node) {
          if (!isPublicKey(args.path.introduction_node)) {
            return cbk([400, 'ExpectedIntroductionKeyToRequestNetworkReply']);
          }
        }

        if (!!args.path.introduction_edge) {
          if (typeof args.path.introduction_edge !== 'string') {
            return cbk([400, 'ExpectedIntroductionEdgeToRequestNetworkReply']);
          }
        }

        if (!!args.introduction && !isPublicKey(args.introduction)) {
          return cbk([400, 'ExpectedReplyIntroductionToRequestNetworkReply']);
        }

        if (args.timeout !== undefined && !isTimeout(args.timeout)) {
          return cbk([400, 'ExpectedPositiveTimeoutToRequestNetworkReply']);
        }

        if (!isArray(args.types) || !args.types.length) {
          return cbk([400, 'ExpectedReplyTypesToRequestNetworkReply']);
        }

        return cbk();
      },

      // Get the self identity key to use as the end of the reply path
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Determine the outbound hops to reach the path introduction node
      getOutbound: ['validate', ({}, cbk) => {
        return getPathOutbound({lnd: args.lnd, path: args.path}, cbk);
      }],

      // Listen to incoming onion messages
      subscribe: ['getIdentity', 'getOutbound', ({}, cbk) => {
        // Subscribing throws when LND does not support onion messages
        try {
          return cbk(null, subscribeToMessages({lnd: args.lnd}));
        } catch (err) {
          return cbk([
            501,
            'ExpectedLndSupportingOnionMessagesToRequestNetworkReply',
            {err},
          ]);
        }
      }],

      // Send the message and wait for the reply
      request: [
        'getIdentity',
        'getOutbound',
        'subscribe',
        ({getIdentity, getOutbound, subscribe}, cbk) =>
      {
        let isFinished = false;
        let timer;

        // Stop listening and waiting and return the result
        const finished = (err, res) => {
          // Exit early when the request already finished
          if (isFinished) {
            return;
          }

          isFinished = true;

          clearTimeout(timer);

          subscribe.removeAllListeners();

          return cbk(err, res);
        };

        // Stop waiting for a reply if things have gone on too long
        timer = setTimeout(() => {
          return finished([0, 'NetworkRequestTimeout']);
        },
        args.timeout || defaultTimeoutMs);

        // An error on the subscription
        subscribe.on('error', err => {
          return finished([503, 'NetworkReplyListenerFailed', {err}]);
        });

        // The subscription closed, so no reply can arrive
        subscribe.on('end', () => {
          return finished([503, 'NetworkReplyListenerEnded']);
        });

        // Wait for a reply message
        subscribe.on('message_received', received => {
          // Exit early when there is no message
          if (!received.message) {
            return;
          }

          // Exit early when the message is not one of the reply types
          if (!args.types.includes(received.message.type)) {
            return;
          }

          // Check the reply arrived on the reply path of the message
          return asyncAuto({
            // Get the path id of the path that the reply arrived on
            getPathId: cbk => getPathId({
              encrypted: received.encrypted,
              key: received.key,
              lnd: args.lnd,
            },
            cbk),

            // Wait for the message to be sent to know its reply path id
            sent: cbk => sending.then(sent => cbk(null, sent), cbk),
          },
          (err, res) => {
            // Exit early and keep waiting when the message cannot be read,
            // since it can be from anyone. A failure to send is handled when
            // sending.
            if (!!err) {
              return;
            }

            // Exit early when the message came in on a different path
            if (!res.getPathId.id || res.getPathId.id !== res.sent.reply) {
              return;
            }

            return finished(null, {
              reply: {
                type: received.message.type,
                value: received.message.value,
              },
            });
          });
        });

        // Keys are used in lowercase, as LND gives them
        const introduction = (args.introduction || String()).toLowerCase();

        // Send the message with a reply path back to self
        const sending = sendMessage({
          inbound: args.path.hops,
          key: args.path.key,
          lnd: args.lnd,
          message: args.message,
          outbound: getOutbound.outbound,
          reply: [introduction, getIdentity.public_key].filter(n => !!n),
        });

        return sending.catch(err => finished(err));
      }],
    },
    returnResult({reject, resolve, of: 'request'}, cbk));
  });
};
