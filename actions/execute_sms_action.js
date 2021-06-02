const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {isSmsConfigured} = require('./../config');
const sendTwilioSms = require('./send_twilio_sms');

/** Deliver inbox message via SMS

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
          return cbk([400, 'ExpectedEnvironmentVarsToExecuteSmsAction']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToExecuteSmsAction']);
        }

        if (!isSmsConfigured({env})) {
          return cbk([404, 'InboxServiceNotSupported']);
        }

        if (!message) {
          return cbk([400, 'ExpectedMessageToExecuteSmsAction']);
        }

        return cbk();
      },

      // SMS text body
      text: ['validate', ({}, cbk) => {
        // Exit early when there is no reply address
        if (!reply) {
          return cbk(null, message);
        }

        return cbk(null, `${message}\n\nReply To:\n${reply}`);
      }],

      // Send the SMS
      send: ['text', ({text}, cbk) => {
        return sendTwilioSms({
          fetch,
          text,
          account: env.PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID,
          from: env.PAID_SERVICES_INBOX_SMS_FROM_NUMBER,
          key: env.PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN,
          to: env.PAID_SERVICES_INBOX_SMS_TO_NUMBER,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
