const {sendMessageToPeer} = require('ln-service');

const encodePeerResponse = require('./encode_peer_response');

const defaultServerError = [500, 'InternalServiceError'];

/** Return handler for success response

  {
    from: <Requst From Node Id Public Key Hex String>
    id: <Request Id Hex String>
    lnd: <Authenticated LND API Object>
    service: {
      error: <Report Error Function>
    }
  }

  @returns
  <Handle Success Response Function>
*/
module.exports = ({from, id, lnd, service}) => {
  return args => {
    if (!args) {
      throw new Error('ExpectedSuccessArgumentsToReturnSuccessPeerResponse');
    }

    // Encode the message to send to the peer
    const {message} = (() => {
      try {
        return encodePeerResponse({id, records: args.records});
      } catch (err) {
        service.error([503, err.message]);

        return encodePeerResponse({id, failure: defaultServerError});
      }
    })();

    // Tell the peer about the success
    return sendMessageToPeer({lnd, message, public_key: from}, err => {
      if (!!err) {
        return service.error([503, 'ErrorSendingSuccessMessage', {err}]);
      }

      return;
    });
  };
};
