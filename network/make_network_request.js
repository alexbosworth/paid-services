const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const asyncify = require('async/asyncify');
const {returnResult} = require('asyncjs-util');

const encodePeerRequest = require('./../p2p/encode_peer_request');
const parseRequestMessage = require('./../p2p/parse_request_message');
const requestNetworkReply = require('./request_network_reply');

const {isArray} = Array;
const isPublicKey = n => typeof n === 'string' && /^[0-9A-F]{66}$/i.test(n);
const isTimeout = n => Number.isSafeInteger(n) && n > 0;
const makeId = () => randomBytes(32).toString('hex');
const peerRequestType = 32768;
const typeNetworkRequest = '32769';

/** Make a network request over onion messages, sent over a blinded path of
  the destination, with the response returned over a reply path back along
  the route of the request

  The request fails when no response arrives within the `timeout`.

  {
    lnd: <Authenticated LND API Object>
    path: {
      hops: [{
        encrypted_data: <Encrypted Recipient Data Hex String>
        relay_key: <Blinded Relaying Node Public Key Hex String>
      }]
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
      key: <First Hop Path Key Public Key Hex String>
    }
    [records]: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
    [timeout]: <Response Timeout Milliseconds Number> // Default: 30000
    type: <Request Type Number String>
  }

  @throws error via cbk or Promise
  [0, NetworkRequestTimeout]

  @returns via cbk or Promise
  {
    [records]: [{
      type: <Type Number String>
      value: <Value Hex Encoded String>
    }]
  }
*/
module.exports = ({lnd, path, records, timeout, type}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedLndToMakeNetworkRequest']);
        }

        if (!path) {
          return cbk([400, 'ExpectedBlindedPathToMakeNetworkRequest']);
        }

        if (!isArray(path.hops) || !path.hops.length) {
          return cbk([400, 'ExpectedBlindedPathHopsToMakeNetworkRequest']);
        }

        if (!path.introduction_edge && !path.introduction_node) {
          return cbk([400, 'ExpectedPathIntroductionToMakeNetworkRequest']);
        }

        // A node introduction is looked up as a public key
        if (!!path.introduction_node && !isPublicKey(path.introduction_node)) {
          return cbk([400, 'ExpectedIntroductionKeyToMakeNetworkRequest']);
        }

        if (!!path.introduction_edge) {
          if (typeof path.introduction_edge !== 'string') {
            return cbk([400, 'ExpectedIntroductionEdgeToMakeNetworkRequest']);
          }
        }

        if (!path.key) {
          return cbk([400, 'ExpectedBlindedPathKeyToMakeNetworkRequest']);
        }

        if (timeout !== undefined && !isTimeout(timeout)) {
          return cbk([400, 'ExpectedPositiveTimeoutToMakeNetworkRequest']);
        }

        if (!type) {
          return cbk([400, 'ExpectedTypeToMakeNetworkRequest']);
        }

        return cbk();
      },

      // Generate an id for the request
      id: ['validate', ({}, cbk) => cbk(null, makeId())],

      // Encode the request message
      message: ['id', asyncify(({id}) => {
        try {
          const {message} = encodePeerRequest({id, records, type});

          return {type: typeNetworkRequest, value: message};
        } catch (err) {
          throw [400, err.message];
        }
      })],

      // Send the request and wait for the reply on its reply path
      getReply: ['message', ({message}, cbk) => {
        return requestNetworkReply({
          lnd,
          message,
          path,
          timeout,
          types: [typeNetworkRequest],
        },
        cbk);
      }],

      // Read the response to the request
      request: ['getReply', 'id', asyncify(({getReply, id}) => {
        try {
          parseRequestMessage({
            message: getReply.reply.value,
            type: peerRequestType,
          });
        } catch (err) {
          throw [503, 'ExpectedResponseToNetworkRequest'];
        }

        const {response} = parseRequestMessage({
          message: getReply.reply.value,
          type: peerRequestType,
        });

        if (!response || response.id !== id) {
          throw [503, 'ExpectedResponseToNetworkRequest'];
        }

        // Exit early when the server responds with a failure code
        if (!!response.failure) {
          throw response.failure;
        }

        return {records: response.records};
      })],
    },
    returnResult({reject, resolve, of: 'request'}, cbk));
  });
};
