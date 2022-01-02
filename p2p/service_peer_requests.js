const {sendMessageToPeer} = require('ln-service');
const {subscribeToPeerMessages} = require('ln-service');

const defaultServerError = [500, 'InternalServiceError'];
const encodePeerResponse = require('./encode_peer_response');
const parseRequestFailure = (report, n) => { report([503, n]); return {}; };
const parseRequestMessage = require('./parse_request_message');
const returnFailureResponse = require('./return_failure_response');
const returnSuccessResponse = require('./return_success_response');

/** Get a p2p message listener

  {
    lnd: <Authenticated LND API Object>
  }

  @returns
  {
    end: <Add a Service Ended Function>
    error: <Add an Error Listener Function>
    request: <Add A Request Listener For Type Function>
    stop: <Stop Listening Function> ({}) => {};
  }

    request:
    {
      type: <Type Number String>
    }

    @returns via cbk
    {
      from: <Request From Node Id Hex Encoded Public Key String>
      [records]: [{
        type: <Type Number String>
        value: <Value Hex String>
      }]
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
module.exports = ({lnd}) => {
  const listeners = {};
  const service = {end: () => {}, error: () => {}};
  const sub = subscribeToPeerMessages({lnd});

  sub.on('error', error => {
    service.error(error);

    return service.end();
  });

  sub.on('message_received', received => {
    const from = received.public_key;
    const {message} = received;
    const {type} = received;

    // Parse out the p2p request message details
    const {request} = (() => {
      try {
        return parseRequestMessage({message, type});
      } catch (err) {
        return parseRequestFailure(service.error, err.message);
      }
    })();

    // Exit early when the received message isn't actually a p2p request
    if (!request) {
      return;
    }

    // Exit early when nothing is listening for this type
    if (!listeners[request.type]) {
      return;
    }

    const {id} = request;
    const req = {from, records: request.records};

    const failure = returnFailureResponse({from, id, lnd, service});
    const success = returnSuccessResponse({from, id, lnd, service});

    // Call the listener to tell it about the request
    return listeners[request.type](req, {failure, success});
  });

  return {
    end: cbk => service.end = cbk,
    error: cbk => service.error = cbk,
    request: ({type}, cbk) => listeners[type] = cbk,
    stop: ({}) => sub.removeAllListeners(),
  };
};
