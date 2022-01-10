const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');
const {acceptsChannelOpen} = require('ln-sync');
const {connectPeer} = require('ln-sync');




module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {

        if (!args.lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProposeChnnaleOpen']);
        }

        if (!args.public_key) {
          return cbk([400, 'ExpectedPublicKeyToProposeChannelOpen']);
        }

        if (!args.amount) {
          return cbk([400, 'ExpectedAmountToProposeChannelOpen']);
        }

        return cbk();
      },

      // Connect to the peer
      connect: ['validate', ({}, cbk) => {
        return connectPeer({id: args.public_key, lnd: args.lnd}, cbk);
      }],

      //Propose a channel open to check acceptance
      checkAccept: ['validate', 'connect', ({}, cbk) => {
        return acceptsChannelOpen({
          lnd: args.lnd,
          capacity: args.amount,
          is_private: false,
          partner_public_key: args.public_key,
        },
        cbk);
      }],

    },
    returnResult({reject, resolve, of: 'checkAccept'}, cbk));
  });
};
