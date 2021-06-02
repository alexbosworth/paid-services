const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {isEmailConfigured} = require('./../config');
const sendPostmarkEmail = require('./send_postmark_email');

const subject = 'Inbox KeySend Service Message';

/** Deliver inbox message via email

  {
    env: <Environment Variables Object>
    fetch: <Fetch Function>
    message: <Message String>
    [reply]: <Reply To String>
  }

  @returns via cbk or Promise
*/
module.exports = ({env, fetch, message, reply}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvironmentVarsToExecuteEmailAction']);
        }

        if (!isEmailConfigured({env})) {
          return cbk([404, 'InboxServiceNotSupported']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToExecuteEmailAction']);
        }

        if (!message) {
          return cbk([400, 'ExpectedMessageToExecuteEmailAction']);
        }

        return cbk();
      },

      // Email text body
      text: ['validate', ({}, cbk) => {
        // Exit early when there is no reply information
        if (!reply) {
          return cbk(null, message);
        }

        return cbk(null, `${message}\n\nReply To:\n${reply}`);
      }],

      // Send the email
      send: ['text', ({text}, cbk) => {
        return sendPostmarkEmail({
          fetch,
          subject,
          text,
          from: env.PAID_SERVICES_INBOX_EMAIL_FROM,
          key: env.PAID_SERVICES_INBOX_POSTMARK_API_KEY,
          to: env.PAID_SERVICES_INBOX_EMAIL_TO,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
