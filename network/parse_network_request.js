const parseRequestMessage = require('./../p2p/parse_request_message');

const peerRequestType = 32768;

/** Parse a network request, which uses the peer request encoding

  A message that cannot be parsed returns an error so that it can be reported

  {
    message: <Network Request Message Hex String>
  }

  @returns
  {
    [err]: [<Error Code Number>, <Error Message String>]
    [request]: {
      id: <Request Id Hex String>
      records: [{
        type: <Type Number String>
        value: <Value Hex String>
      }]
      type: <Type Number String>
    }
  }
*/
module.exports = ({message}) => {
  try {
    const {request} = parseRequestMessage({message, type: peerRequestType});

    return {request};
  } catch (err) {
    return {err: [503, err.message]};
  }
};
