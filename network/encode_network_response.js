const encodePeerResponse = require('./../p2p/encode_peer_response');

const defaultServerError = [500, 'InternalServiceError'];

/** Encode a response to a network request

  When the response cannot be encoded, a generic server failure is encoded in
  its place, and the encoding error is returned so that it can be reported

  {
    [failure]: [
      <Failure Code Number>
      <Failure Message String>
    ]
    id: <Request Id Hex String>
    [records]: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }

  @returns
  {
    [err]: [<Error Code Number>, <Error Message String>]
    message: <Encoded Response Hex String>
  }
*/
module.exports = ({failure, id, records}) => {
  try {
    return {message: encodePeerResponse({failure, id, records}).message};
  } catch (err) {
    return {
      err: [503, err.message],
      message: encodePeerResponse({id, failure: defaultServerError}).message,
    };
  }
};
