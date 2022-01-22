const asyncAuto = require('async/auto');
const {getNodeAlias} = require('ln-sync');
const {returnResult} = require('asyncjs-util');

const describeCapacityChange = require('./describe_capacity_change');

/** Ask to select a change

  {
    ask: <Inquirer Ask Function>
    [address]: <Cooperative Close Address String>
    capacity: <Channel Capacity Tokens Number>
    channel: <Change Channel Id String>
    [decrease]: <Capacity Change Decrease Tokens Number>
    from_id: <Peer Public Key Hex String>
    [increase]: <Capacity Change Increase Tokens Number>
    lnd: <Authenticated LND API Object>
    [to_id]: <Node Public Key Hex String>
    [type]: <Channel Type String>
  }

  @returns via cbk or Promise
  {
    is_selected: <Request to Change Channel is Selected Bool>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!args.ask) {
          return cbk([400, 'ExpectedAskFunctionToAskToSelectChange']);
        }

        if (!args.capacity) {
          return cbk([400, 'ExpectedChannelCapacityToAskToSelectChange']);
        }

        if (!args.channel) {
          return cbk([400, 'ExpectedChannelIdToAskToSelectAChangeFor']);
        }

        if (!args.from_id) {
          return cbk([400, 'ExpectedChannelPartnerPublicKeyToSelectChange']);
        }

        if (!args.lnd) {
          return cbk([400, 'ExpectedLndApiToAskToSelectChange']);
        }

        return cbk();
      },

      // Get the peer alias
      getPeerAlias: ['validate', ({}, cbk) => {
        return getNodeAlias({id: args.from_id, lnd: args.lnd}, cbk);
      }],

      // Get the alias of the node to move to
      getNodeAlias: ['validate', ({}, cbk) => {
        // Exit early when there is no new node to move to
        if (!args.to_id) {
          return cbk(null, {});
        }

        return getNodeAlias({id: args.to_id, lnd: args.lnd}, cbk);
      }],

      // Confirm acceptance of the change
      confirm: [
        'getNodeAlias',
        'getPeerAlias',
        ({getNodeAlias, getPeerAlias}, cbk) =>
      {
        const message = describeCapacityChange({
          capacity: args.capacity,
          channel: args.channel,
          decrease: args.decrease,
          from_alias: getPeerAlias.alias,
          from_id: args.from_id,
          increase: args.increase,
          to_alias: getNodeAlias.alias,
          to_id: args.to_id,
          type: args.type,
        });

        return args.ask({
          message,
          name: 'accept',
          type: 'confirm',
        },
        ({accept}) => {
          if (!accept) {
            return cbk(null, {is_selected: false});
          }

          // Fail changing when cooperative_close_address is set
          if (!!args.address && !args.increase) {
            return cbk([400, 'ChannelHasLockedCoopCloseAddressSet']);
          }

          return cbk(null, {is_selected: true});
        });
      }],
    },
    returnResult({reject, resolve, of: 'confirm'}, cbk));
  });
};
