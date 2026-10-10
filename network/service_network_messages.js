const {subscribeToMessages} = require('ln-service');

const getPathId = require('./get_path_id');
const getPathOutbound = require('./get_path_outbound');
const regularReplyBytes = require('./regular_reply_bytes');
const returnNetworkResponse = require('./return_network_response');

const failedReplyBytes = err => [400, 'FailedToGetRegularReplyBytes', {err}];
const {isArray} = Array;
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})+$/i.test(n);
const isLargeOnion = onion => !!onion && onion.length / 2 === largeOnionBytes;
const largeOnionBytes = 32834;
const stoppedError = [503, 'ServiceStoppedBeforeReplyWasSent'];

/** Get a listener for onion messages received over the network

  Listeners are added for a message payload record type, and are passed the
  messages that arrive on one of the `ids` paths, or on any path when none
  are given. A `reply` function is only given for messages with a reply path.

  `is_large` is true for a message that arrived in a large onion message,
  false for one of the regular size, and not set when the size is not known.
  A reply sent with `is_regular` is only sent when it fits in an onion
  message of the regular size. `reply_bytes` gives the most bytes of such a
  reply that fit, or -1 when no reply fits.

  The `end` listener is called when the stream of messages stops, after the
  `error` listener when it fails. After the service stops, a reply that was
  being prepared is not sent, its callback is given an error, and nothing is
  reported to the error listener.

  {
    [ids]: [<Accepted Path Identifier Hex String>]
    lnd: <Authenticated LND API Object>
  }

  @returns
  {
    end: <Add a Service Ended Function>
    error: <Add an Error Listener Function>
    message: <Add A Message Listener For Payload Type Function>
    receivers: <Get Count of Message Listeners Function>
    stop: <Stop Listening Function> ({}) => {};
  }

    message:
    {
      type: <Message Payload Record Type Number String>
    }

    @returns via cbk
    {
      [is_large]: <Received In a Large Onion Message Bool>
      [path_id]: <Received On Blinded Path Identifier Hex String>
      reply_hops: <Reply Path Hops Count Number>
      value: <Message Payload Hex String>
      via: <Received Via Peer Public Key Hex String>
    }
    {
      [reply]: <Send Reply Through Reply Path Function>
      [reply_bytes]: <Get Most Reply Bytes For Regular Size Function>
    }

      reply:
      {
        [is_regular]: <Only Send In Onion Message Of Regular Size Bool>
        type: <Reply Payload Record Type Number String>
        value: <Reply Payload Hex String>
      }

      @returns via optional cbk
      {}

      reply_bytes:
      {
        type: <Reply Payload Record Type Number String>
      }

      @returns via cbk
      {
        bytes: <Most Reply Payload Bytes For Regular Size, -1 For None Number>
      }
*/
module.exports = ({ids, lnd}) => {
  if (!!ids && !isArray(ids)) {
    throw new Error('ExpectedArrayOfPathIdsToServiceNetworkMessages');
  }

  if (!!ids && !ids.every(isHex)) {
    throw new Error('ExpectedHexPathIdsToServiceNetworkMessages');
  }

  // Path ids are compared in lowercase
  const accepted = !ids ? undefined : ids.map(id => id.toLowerCase());

  const listeners = {};
  const service = {end: () => {}, error: () => {}};
  const sub = subscribeToMessages({lnd});

  let isStopped = false;

  // Stop listening, and tell the caller, when the messages stream stops
  const ended = err => {
    // Exit early when the service was already stopped
    if (isStopped) {
      return;
    }

    isStopped = true;

    // Removing the listeners cancels the subscription
    sub.removeAllListeners();

    if (!!err) {
      service.error(err);
    }

    return service.end();
  };

  // The stream can close normally, or fail
  sub.on('end', () => ended());
  sub.on('error', err => ended(err));

  sub.on('message_received', received => {
    const {message} = received;

    // Exit early when there is no message payload
    if (!message) {
      return;
    }

    // Exit early when nothing is listening for this type
    if (!listeners[message.type]) {
      return;
    }

    const {encrypted, key, reply} = received;

    let outbound;

    // The route to the reply path is found once for a message
    const getOutbound = () => {
      // Exit early when the route was already found or is being found
      if (!!outbound) {
        return outbound;
      }

      const lookup = getPathOutbound({lnd, path: reply});

      outbound = lookup;

      // A failed lookup is not kept, so that a later reply can try again
      lookup.catch(() => {
        if (outbound === lookup) {
          outbound = undefined;
        }
      });

      return lookup;
    };

    // Send a reply message back through the reply path
    const sendReply = ({is_regular, type, value}, cbk) => {
      const response = {type, value};

      const done = err => {
        // Exit early when the caller is told how the reply went
        if (!!cbk) {
          return !!err ? cbk(err) : cbk(null, {});
        }

        // Exit early when the reply was sent, or when the service stopped
        if (!err || isStopped) {
          return;
        }

        return service.error([503, 'ErrorSendingNetworkReply', {err}]);
      };

      // Exit early when the service already stopped
      if (isStopped) {
        return setImmediate(() => done(stoppedError));
      }

      // The caller is told outside of the promise chain, so that a throw in
      // the caller is not taken as a failure to send
      return getOutbound()
        .then(res => {
          // Exit early when the service stopped while the route was found
          if (isStopped) {
            return Promise.reject(stoppedError);
          }

          return returnNetworkResponse({
            is_regular,
            lnd,
            reply,
            message: response,
            outbound: res.outbound,
          });
        })
        .then(() => setImmediate(() => done()), err => {
          return setImmediate(() => done(err));
        });
    };

    // Get the most bytes of a reply that fit in a regular size message
    const replyBytes = ({type}, cbk) => {
      // Exit early when the service already stopped
      if (isStopped) {
        return setImmediate(() => cbk(stoppedError));
      }

      // The caller is told outside of the promise chain, so that it is only
      // called once, even when it throws
      return getOutbound()
        .then(res => regularReplyBytes({
          type,
          inbound: reply.inbound,
          key: reply.key,
          outbound: res.outbound,
        }))
        .then(res => setImmediate(() => cbk(null, res)), err => {
          // A route failure is an error array, otherwise encoding failed
          const error = isArray(err) ? err : failedReplyBytes(err);

          return setImmediate(() => cbk(error));
        });
    };

    // Decrypt the path id to check which path the message arrived on
    return getPathId({encrypted, key, lnd}, (err, res) => {
      // Exit early when the service stopped while the path id was decrypted
      if (isStopped) {
        return;
      }

      if (!!err) {
        return service.error([503, 'FailedToGetNetworkMessagePathId', {err}]);
      }

      // Path ids are compared in lowercase
      const pathId = !res.id ? undefined : res.id.toLowerCase();

      // Exit early when the message did not arrive on an accepted path
      if (!!accepted && !accepted.includes(pathId)) {
        return;
      }

      const msg = {
        is_large: !received.onion ? undefined : isLargeOnion(received.onion),
        path_id: pathId,
        reply_hops: !reply ? Number() : reply.inbound.length,
        value: message.value,
        via: received.via,
      };

      // Call the listener to tell it about the message
      return listeners[message.type](msg, {
        reply: !reply ? undefined : sendReply,
        reply_bytes: !reply ? undefined : replyBytes,
      });
    });
  });

  return {
    end: cbk => service.end = cbk,
    error: cbk => service.error = cbk,
    message: ({type}, cbk) => listeners[type] = cbk,
    receivers: () => sub.listenerCount('message_received'),
    stop: ({}) => {
      isStopped = true;

      return sub.removeAllListeners();
    },
  };
};
