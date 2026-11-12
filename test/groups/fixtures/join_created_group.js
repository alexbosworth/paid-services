const asyncAuto = require('async/auto');
const asyncEnsureAsync = require('async/ensureAsync');
const asyncRace = require('async/race');
const asyncReflect = require('async/reflect');
const {returnResult} = require('asyncjs-util');

const createGroupChannel = require('./../../../groups/create_group_channel');
const encodePeerRequest = require('./../../../p2p/encode_peer_request');
const makeLnd = require('./make_lnd');
const {outsider} = require('./group_members');
const {serviceTypeFindGroupPartners} = require('./../../../service_types');

// Extract the group id from an invite code
const groupIdFromCode = code => code.slice(66);
// Decode peer request bytes
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
// Read an invite code from a log entry
const inviteCode = entry => entry.group_invite_code;
// Signal that the invite code was logged
const logInvite = (cbk, n) => !!inviteCode(n) && cbk(null, inviteCode(n));
// Use a repeatable peer request id
const requestId = () => '00'.repeat(32);

/** Start coordination and try to join from outside any allowed list

  {
    [members]: [<Allowed Node Public Key Hex String>]
  }

  @returns via cbk or Promise
  {
    [error]: <Group Creation Error Array>
    [failure]: <Peer Response Failure Array>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Create the LND stub and response recorder
      setup: cbk => cbk(null, makeLnd()),

      // Wait for the invite or a failure to start coordination
      start: ['setup', asyncReflect(asyncEnsureAsync(({setup}, cbk) => {
        return asyncRace([
          cbk => setup.invite = cbk,
          cbk => createGroupChannel({
            capacity: 100000,
            count: 3,
            lnd: setup.lnd,
            logger: {info: entry => logInvite(setup.invite, entry)},
            rate: 1,
            ...args,
          }, cbk),
        ], cbk);
      }))],

      // Send the join request and summarize the response
      join: ['setup', 'start', ({setup, start}, cbk) => {
        if (!!start.error) {
          return cbk(null, {error: start.error});
        }

        const id = groupIdFromCode(start.value);
        const {message} = encodePeerRequest({
          id: requestId(),
          records: [{type: '1', value: id}],
          type: serviceTypeFindGroupPartners,
        });

        setup.subscription.emit('data', {
          data: hexAsBuffer(message),
          peer: hexAsBuffer(outsider),
          type: 32768,
        });

        const [reply] = setup.replies;

        return cbk(null, {failure: reply.response.failure});
      }],

      // Release the fake subscription after each case
      clean: ['join', 'setup', ({setup}, cbk) => {
        setup.subscription.removeAllListeners();

        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'join'}, cbk));
  });
};
