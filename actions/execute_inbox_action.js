const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const executeEmailAction = require('./execute_email_action');
const executeSmsAction = require('./execute_sms_action');
const inboxActionArguments = require('./inbox_action_arguments');
const {isEmailConfigured} = require('./../config');
const {isSmsConfigured} = require('./../config');

/** Send an email to fulfill an inbox service request

  {
    arguments: <Hex Encoded Inbox Service Arguments String>
    env: <Environment Variables Object>
    fetch: <Node Fetch Function>
  }

  @returns via cbk or Promise
*/
module.exports = ({arguments, env, fetch}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!arguments) {
          return cbk([400, 'ExpectedInboxServiceArgumentsToExecuteAction']);
        }

        try {
          inboxActionArguments({encoded: arguments});
        } catch (err) {
          return cbk([400, err.message]);
        }

        if (!env) {
          return cbk([400, 'ExpectedEnvVariablesToExecuteInboxAction']);
        }

        if (!isEmailConfigured({env}) && !isSmsConfigured({env})) {
          return cbk([404, 'InboxServiceNotEnabled']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToExecuteInboxAction']);
        }

        return cbk();
      },

      // Decode inbox action arguments
      decodeArguments: ['validate', ({getServiceRequest}, cbk) => {
        const inbox = inboxActionArguments({encoded: arguments});

        return cbk(null, {message: inbox.message, reply: inbox.reply});
      }],

      // Deliver inbox message as an email
      email: ['decodeArguments', ({decodeArguments}, cbk) => {
        if (!isEmailConfigured({env})) {
          return cbk();
        }

        return executeEmailAction({
          env,
          fetch,
          message: decodeArguments.message,
          reply: decodeArguments.reply || undefined,
        },
        cbk);
      }],

      // Deliver inbox message as an sms
      sms: ['decodeArguments', ({decodeArguments}, cbk) => {
        if (!isSmsConfigured({env})) {
          return cbk();
        }

        return executeSmsAction({
          env,
          fetch,
          message: decodeArguments.message,
          reply: decodeArguments.reply || undefined,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
