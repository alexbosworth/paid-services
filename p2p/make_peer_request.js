const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {sendMessageToPeer} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const encodePeerRequest = require('./encode_peer_request');
const parseRequestFailure = (msg, cbk) => { cbk([503, msg]); return {}; };
const parseRequestMessage = require('./parse_request_message');

const makeId = () => randomBytes(32).toString('hex');

/** Make a peer request

  {
    lnd: <Authenticated LND API Object>
    [records]: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
    [timeout]: <Peer Response Timeout Milliseconds>
    to: <Node Id Public Key Hex String>
    type: <Request Type Number String>
  }

  @throws error via cbk or Promise
  [0, PeerRequestTimeout]

  @returns via cbk or Promise
  {
    [records]: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
  }
*/
module.exports = ({lnd, records, timeout, to, type}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToMakePeerRequest']);
        }

        if (!to) {
          return cbk([400, 'ExpectedPublicKeyToMakePeerRequestTo']);
        }

        if (!type) {
          return cbk([400, 'ExpectedTypeToMakePeerRequest']);
        }

        return cbk();
      },

      // Generate an id for the request
      id: ['validate', ({}, cbk) => cbk(null, makeId())],

      // Encode the request message
      message: ['id', ({id}, cbk) => {
        try {
          // Encode the peer request elements into an encoded request
          const {message} = encodePeerRequest({id, records, type});

          return cbk(null, message);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Make the request to the peer
      request: ['id', 'message', ({id, message}, cbk) => {
        // Listen to incoming peer messages
        const sub = subscribeToPeerMessages({lnd});

        // Stop waiting for a response if things have gone on too long
        const timer = (() => {
          return !timeout ? null : setTimeout(() => {
            sub.removeAllListeners();

            return cbk([0, 'PeerRequestTimeout']);
          },
          timeout);
        })();

        // An error on the subscription
        sub.on('error', err => {
          // Stop listening
          sub.removeAllListeners();

          // Stop the timeout timer
          clearTimeout(timer);

          return cbk([503, 'PeerRequestResponseListenerFailed', {err}]);
        });

        // Wait for a message on the request id
        sub.on('message_received', received => {
          // Exit early on messages from other nodes
          if (received.public_key !== to) {
            return;
          }

          const {response} = (() => {
            try {
              return parseRequestMessage(received);
            } catch (err) {
              return parseRequestFailure(err.message, cbk);
            }
          })();

          // Exit early when this message is not a reponse to the request
          if (!response || response.id !== id) {
            return;
          }

          // Stop the timeout timer
          clearTimeout(timer);

          // Remove listener for response
          sub.removeAllListeners();

          // Exit early when the server responds with a failure code
          if (!!response.failure) {
            return cbk(response.failure);
          }

          return cbk(null, {records: response.records});
        });

        // Send the peer request
        return sendMessageToPeer({lnd, message, public_key: to}, err => {
          if (!!err) {
            // Stop timeout when there was an error sending
            clearTimeout(timer);

            // Stop listening for a response when there was an error
            sub.removeAllListeners();

            return cbk(err);
          }

          return;
        });
      }],
    },
    returnResult({reject, resolve, of: 'request'}, cbk));
  });
};
