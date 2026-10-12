const asyncAuto = require('async/auto');
const asyncWhilst = require('async/whilst');
const {getChannel} = require('ln-service');
const {getIdentity} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const getMessageHops = require('./get_message_hops');
const getPathAfterSelf = require('./get_path_after_self');
const pathIntroduction = require('./path_introduction');

const edgeChannel = edge => edge.split('x').slice(0, -1).join('x');
const {isArray} = Array;
const isPublicKey = n => typeof n === 'string' && /^[0-9A-F]{66}$/i.test(n);

/** Get the outbound hops to reach the introduction node of a blinded path,
  with the hops and the path key to send over

  When the introduction node is not a connected peer, the message is relayed
  along a payment route through nodes that relay onion messages

  A path that starts at self is sent from the next node of the path: self
  reads its own hops, as an introduction node would, and sends over the hops
  after them. A path that does not start at self is sent over as it is.

  {
    [is_expecting_reply]: <Reply Comes Back Along the Same Nodes Bool>
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
  }

  @returns via cbk or Promise
  {
    hops: [{
      encrypted_data: <Encrypted Recipient Data Hex String>
      relay_key: <Blinded Relaying Node Public Key Hex String>
    }]
    key: <First Hop Path Key Public Key Hex String>
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

        if (!isArray(args.path.hops) || !args.path.hops.length) {
          return cbk([400, 'ExpectedBlindedPathHopsToGetPathOutbound']);
        }

        // A node introduction is compared to self as a public key
        if (!!args.path.introduction_node) {
          if (!isPublicKey(args.path.introduction_node)) {
            return cbk([400, 'ExpectedIntroductionNodeKeyToGetPathOutbound']);
          }
        }

        if (!args.path.key) {
          return cbk([400, 'ExpectedBlindedPathKeyToGetPathOutbound']);
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

      // Get the identity key of self, which the path can start at
      getIdentity: ['validate', ({}, cbk) => {
        return getIdentity({lnd: args.lnd}, cbk);
      }],

      // Determine the introduction node of the path
      introduction: ['getChannel', ({getChannel}, cbk) => {
        try {
          const {introduction} = pathIntroduction({
            channel: getChannel,
            path: args.path,
          });

          // Node keys are compared in lowercase, as LND gives them
          return cbk(null, introduction.toLowerCase());
        } catch (err) {
          return cbk([400, err.message]);
        }
      }],

      // Step past the hops of self while the path starts at self
      stepped: [
        'getIdentity',
        'introduction',
        ({getIdentity, introduction}, cbk) =>
      {
        const identity = getIdentity.public_key;

        let path = {
          hops: args.path.hops,
          introduction_node: introduction,
          key: args.path.key,
        };

        // Self reads its own hop as an introduction node would, and the path
        // goes on from the next node, which can be self again
        return asyncWhilst(
          cbk => cbk(null, path.introduction_node === identity),
          cbk => {
            return getPathAfterSelf({
              identity,
              hops: path.hops,
              key: path.key,
              lnd: args.lnd,
            },
            (err, res) => {
              if (!!err) {
                return cbk(err);
              }

              path = res;

              return cbk();
            });
          },
          err => !!err ? cbk(err) : cbk(null, path)
        );
      }],

      // Get the hops to relay the message to the introduction node
      getHops: ['stepped', ({stepped}, cbk) => {
        return getMessageHops({
          destination: stepped.introduction_node,
          is_expecting_reply: args.is_expecting_reply,
          lnd: args.lnd,
        },
        cbk);
      }],

      // The outbound hops end at the introduction node of the path to send
      outbound: ['getHops', 'stepped', ({getHops, stepped}, cbk) => {
        return cbk(null, {
          hops: stepped.hops,
          key: stepped.key,
          outbound: getHops.hops,
        });
      }],
    },
    returnResult({reject, resolve, of: 'outbound'}, cbk));
  });
};
