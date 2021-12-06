const {sendMessageToPeer} = require('ln-service');

const encodePeerResponse = require('./encode_peer_response');

const defaultServerError = [500, 'InternalServiceError'];

/** Return a failure response handler

  {
    from: <Requst From Node Id Public Key Hex String>
    id: <Request Id Hex String>
    lnd: <Authenticated LND API Object>
    service: {
      error: <Report Error Function>
    }
  }

  @returns
  <Handle Failure Response Function>
*/
module.exports = ({from, id, lnd, service}) => {
  return failure => {
    // Encode the message to send to the peer
    const {message} = (() => {
      try {
        return encodePeerResponse({id, failure});
      } catch (err) {
        service.error([503, err.message]);

        return encodePeerResponse({id, failure: defaultServerError});
      }
    })();

    // Tell the peer about the failure
    return sendMessageToPeer({lnd, message, public_key: from}, err => {
      if (!!err) {
        return service.error([503, 'ErrorSendingFailureMessage', {err}]);
      }

      return;
    });
  };
};
