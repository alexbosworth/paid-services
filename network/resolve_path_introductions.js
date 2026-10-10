const asyncAuto = require('async/auto');
const asyncMap = require('async/map');
const {getChannel} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const pathIntroduction = require('./path_introduction');

const edgeChannel = edge => edge.split('x').slice(0, -1).join('x');
const {isArray} = Array;

/** Resolve the introduction node of each blinded path, looking up the
  channel of a path that starts at a channel edge

  Paths over channels that cannot be looked up are dropped.

  {
    lnd: <Authenticated LND API Object>
    paths: [{
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
    }]
  }

  @returns via cbk or Promise
  {
    paths: [{
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      introduction_node: <Introduction Node Public Key Hex String>
    }]
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.lnd) {
          return cbk([400, 'ExpectedLndToResolvePathIntroductions']);
        }

        if (!isArray(args.paths)) {
          return cbk([400, 'ExpectedBlindedPathsToResolvePathIntroductions']);
        }

        return cbk();
      },

      // Get the channel of each path that starts at a channel edge
      getChannels: ['validate', ({}, cbk) => {
        return asyncMap(args.paths, (path, cbk) => {
          // Exit early when the path starts at a node
          if (!path.introduction_edge) {
            return cbk();
          }

          const id = edgeChannel(path.introduction_edge);

          return getChannel({id, lnd: args.lnd}, (err, res) => {
            // Exit early when the channel cannot be looked up, so the path
            // is dropped and the other paths can still be used
            if (!!err) {
              return cbk();
            }

            return cbk(null, res);
          });
        },
        cbk);
      }],

      // Set the starting node of each path that can be resolved
      resolved: ['getChannels', ({getChannels}, cbk) => {
        // Paths over a channel that was not found cannot be resolved
        const known = args.paths.filter((path, i) => {
          return !path.introduction_edge || !!getChannels[i];
        });

        const channels = getChannels.filter((channel, i) => {
          return !args.paths[i].introduction_edge || !!channel;
        });

        try {
          const paths = known.map((path, i) => {
            const {introduction} = pathIntroduction({
              path,
              channel: channels[i],
            });

            return {...path, introduction_node: introduction};
          });

          return cbk(null, {paths});
        } catch (err) {
          return cbk([503, err.message]);
        }
      }],
    },
    returnResult({reject, resolve, of: 'resolved'}, cbk));
  });
};
