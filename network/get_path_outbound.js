const asyncAuto = require('async/auto');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getMessageHops = require('./get_message_hops');
const pathIntroduction = require('./path_introduction');

const edgeChannel = edge => edge.split('x').slice(0, -1).join('x');

/** Get the outbound hops to reach the introduction node of a blinded path

  When the introduction node is not a connected peer, the message is relayed
  along a payment route through nodes that relay onion messages

  {
    [is_expecting_reply]: <Reply Comes Back Along the Same Nodes Bool>
    lnd: <Authenticated LND API Object>
    path: {
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
    }
  }

  @returns via cbk or Promise
  {
    outbound: [<Relaying Node Public Key Hex String>]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToGetPathOutbound']);
        }

        if (!args.path) {
          return cbk([400, 'ExpectedBlindedPathToGetPathOutbound']);
        }

        return cbk();
      },

      // Get the channel of the introduction edge
      getChannel: ['validate', ({}, cbk) => {
        // Exit early when the introduction is a node and not an edge
        if (!args.path.introduction_edge) {
          return cbk();
        }

        const id = edgeChannel(args.path.introduction_edge);

        return getChannel({id, lnd: args.lnd}, cbk);
      }],

      // Determine the introduction node of the path
      introduction: ['getChannel', ({getChannel}, cbk) => {
        try {
          const {introduction} = pathIntroduction({
            channel: getChannel,
            path: args.path,
          });

          return cbk(null, introduction);
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Get the hops to relay the message to the introduction node
      getHops: ['introduction', ({introduction}, cbk) => {
        return getMessageHops({
          destination: introduction,
          is_expecting_reply: args.is_expecting_reply,
          lnd: args.lnd,
        },
        cbk);
      }],

      // The outbound hops end at the introduction node
      outbound: ['getHops', ({getHops}, cbk) => {
        return cbk(null, {outbound: getHops.hops});
      }],
    },
    returnResult({reject, resolve, of: 'outbound'}, cbk));
  });
};
