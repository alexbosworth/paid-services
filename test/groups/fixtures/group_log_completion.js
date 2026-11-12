const asyncAuto = require('async/auto');
const asyncEnsureAsync = require('async/ensureAsync');
const EventEmitter = require('node:events');
const {mock} = require('node:test');
const {returnResult} = require('asyncjs-util');

const makeLnd = require('./make_lnd');

// Return the test's controlled coordinator
const assemble = args => args.lnd.assembly;
// Make a repeatable group id
const groupId = () => '00'.repeat(16);
// Select readiness log entries
const isReady = entry => !!entry.ready;
const path = require.resolve('./../../../groups/assemble_channel_group');

// Replace assembly before loading the public method in this test process
require(path);
mock.method(require.cache[path], 'exports', assemble);

const method = require('./../../../groups/create_group_channel');

/** Summarize group completion after logging member aliases

  {
    ids: [<Group Member Public Key String>]
  }

  @returns via cbk or Promise
  {
    callbacks: <Creation Callback Count Number>
    early_callbacks: <Callback Count Before Coordinator Completion Number>
    error: <Creation Error Name String>
    ready: <Readiness Log Count Number>
  }
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Create a controlled coordinator and record completion and logs
      setup: cbk => {
        const fixture = makeLnd();

        fixture.lnd.assembly = {
          events: new EventEmitter(),
          id: groupId(),
        };

        return cbk(null, {fixture, completed: [], logged: []});
      },

      // Wait until creation has installed its coordinator listeners
      start: ['setup', asyncEnsureAsync(({setup}, cbk) => {
        return method({
          capacity: 100000,
          count: 3,
          lnd: setup.fixture.lnd,
          logger: {info: entry => {
            setup.logged.push(entry);

            if (!entry.group_invite_code) {
              return;
            }

            setup.is_started = true;

            return cbk();
          }},
          rate: 1,
        },
        (err, res) => {
          setup.completed.push({err, res});

          if (!setup.is_started) {
            return cbk(err);
          }
        });
      })],

      // Resolve member aliases before the coordinator completes
      filled: ['setup', 'start', ({setup}, cbk) => {
        setup.fixture.lnd.assembly.events.emit('filled', {ids: args.ids});

        setup.early_callbacks = setup.completed.length;

        return cbk();
      }],

      // Confirm the coordinator alone settles group creation
      finish: ['filled', 'setup', ({setup}, cbk) => {
        try {
          setup.fixture.lnd.assembly.events.emit('error', [
            503,
            'TestCoordinatorFailure',
          ]);

          const [completed] = setup.completed;
          const [, error] = completed.err;
          const ready = setup.logged.filter(isReady).length;

          return cbk(null, {
            error,
            ready,
            callbacks: setup.completed.length,
            early_callbacks: setup.early_callbacks,
          });
        } catch (err) {
          return cbk(err);
        }
      }],

      // Release the controlled coordinator listeners
      clean: ['finish', 'setup', ({setup}, cbk) => {
        setup.fixture.lnd.assembly.events.removeAllListeners();

        return cbk();
      }],
    },
    returnResult({reject, resolve, of: 'finish'}, cbk));
  });
};
