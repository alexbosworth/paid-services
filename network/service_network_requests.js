const encodeNetworkResponse = require('./encode_network_response');
const parseNetworkRequest = require('./parse_network_request');
const serviceNetworkMessages = require('./service_network_messages');

const isTooLarge = err => !!err && err[0] === 413;
const tooLargeFailure = [413, 'ResponseTooLarge'];
const typeNetworkRequest = '32769';

/** Get an onion message network request listener

  Requests are onion messages with a single payload record of the network
  request type, encoded like peer requests, that arrive on one of the `ids`
  paths, or on any path when none are given. Requests without a reply path
  are ignored.

  A response is only sent in an onion message as large as its request, or
  of the regular size when the size of the request is not known. When a
  response does not fit, the error is reported to the `error` listener and a
  `[413, 'ResponseTooLarge']` failure is sent in its place.

  {
    [ids]: [<Accepted Path Identifier Hex String>]
    lnd: <Authenticated LND API Object>
  }

  @returns
  {
    end: <Add a Service Ended Function>
    error: <Add an Error Listener Function>
    receivers: <Get Count of Message Listeners Function>
    request: <Add A Request Listener For Type Function>
    stop: <Stop Listening Function> ({}) => {};
  }

    request:
    {
      type: <Type Number String>
    }

    @returns via cbk
    {
      [path_id]: <Received On Blinded Path Identifier Hex String>
      [records]: [{
        type: <Type Number String>
        value: <Value Hex String>
      }]
      via: <Received Via Peer Public Key Hex String>
    }
    {
      failure: <Return Failure Function>
      success: <Return Success Function>
    }

      failure:
      [
        <Return Error Code Number>
        <Return Error Message String>
      ]

      success:
      {
        [records]: [{
          type: <Type Number String>
          value: <Value Hex String>
        }]
      }
*/
module.exports = ({ids, lnd}) => {
  const listeners = {};
  const messages = serviceNetworkMessages({ids, lnd});
  const service = {end: () => {}, error: () => {}};

  let isStopped = false;

  messages.end(() => service.end());
  messages.error(err => service.error(err));

  messages.message({type: typeNetworkRequest}, (received, {reply}) => {
    // Exit early when there is no way to respond to the request
    if (!reply) {
      return;
    }

    // Parse out the request details, network requests use peer encoding
    const {err, request} = parseNetworkRequest({message: received.value});

    // Exit early when the request cannot be parsed
    if (!!err) {
      return service.error(err);
    }

    // Exit early when the received message isn't actually a request
    if (!request) {
      return;
    }

    // Exit early when nothing is listening for this type
    if (!listeners[request.type]) {
      return;
    }

    const {id} = request;

    // A reply to a request that was not large is held to the regular size
    const isRegular = received.is_large !== true;

    // Send an encoded response back through the reply path
    const send = ({message}, cbk) => reply({
      is_regular: isRegular,
      type: typeNetworkRequest,
      value: message,
    },
    cbk);

    // Encode and send a response back through the reply path
    const respond = ({failure, records}) => {
      const encoded = encodeNetworkResponse({failure, id, records});

      if (!!encoded.err) {
        service.error(encoded.err);
      }

      return send(encoded, err => {
        // Exit early when the response was sent, or the service stopped
        if (!err || isStopped) {
          return;
        }

        // Exit early when the response failed for a reason other than size
        if (!isTooLarge(err)) {
          return service.error([503, 'ErrorSendingNetworkReply', {err}]);
        }

        service.error([413, 'NetworkResponseTooLargeToSend', {err}]);

        const tooLarge = encodeNetworkResponse({id, failure: tooLargeFailure});

        // Tell the requester that the response did not fit
        return send(tooLarge, err => {
          if (!!err && !isStopped) {
            return service.error([503, 'ErrorSendingNetworkReply', {err}]);
          }

          return;
        });
      });
    };

    const failure = reason => respond({failure: reason});

    const success = args => {
      if (!args) {
        throw new Error('ExpectedSuccessArgumentsToReturnNetworkResponse');
      }

      return respond({records: args.records});
    };

    const req = {
      path_id: received.path_id,
      records: request.records,
      via: received.via,
    };

    // Call the listener to tell it about the request
    return listeners[request.type](req, {failure, success});
  });

  return {
    end: cbk => service.end = cbk,
    error: cbk => service.error = cbk,
    receivers: messages.receivers,
    request: ({type}, cbk) => listeners[type] = cbk,
    stop: ({}) => {
      isStopped = true;

      return messages.stop({});
    },
  };
};
