const {callbackify} = require('util');
const {URLSearchParams} = require('url');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const auth = (account, key) => `${account}:${key}`;
const {keys} = Object;
const method = 'post';
const url = n => `https://api.twilio.com/2010-04-01/Accounts/${n}/Messages.json`;
const utf8AsBase64 = utf8 => Buffer.from(utf8, 'utf8').toString('base64');

/** Send an SMS to a phone number using Twilio

  {
    account: <Account Identifier String>
    fetch: <Node Fetch Function>
    from: <From Number String>
    key: <Twilio Auth API Key String>
    text: <Body Text String>
    to: <To Number String>
  }

  @returns via cbk or Promise
*/
module.exports = ({account, fetch, from, key, text, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!account) {
          return cbk([400, 'ExpectedAccountIdToSendTwilioSmsMessage']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchMethodToSendTwilioSmsMessage']);
        }

        if (!from) {
          return cbk([400, 'ExpectedFromSmsNumberToSendTwilioSmsMessage']);
        }

        if (!key) {
          return cbk([400, 'ExpectedAuthApiKeyToSendTwilioSmsMessage']);
        }

        if (!text) {
          return cbk([400, 'ExpectedTextToSendInTwilioSmsMessage']);
        }

        if (!to) {
          return cbk([400, 'ExpectedToNumberToSendTwilioSmsMessage']);
        }

        return cbk();
      },

      // Send the SMS message
      send: ['validate', ({}, cbk) => {
        const body = new URLSearchParams();

        const args = {Body: text, From: from, To: to};

        keys(args).forEach(attr => body.append(attr, args[attr]));

        return callbackify(fetch)(url(account), {
          body,
          method,
          headers: {
            Authorization: `Basic ${utf8AsBase64(auth(account, key))}`,
          },
        },
        (err, res) => {
          if (!!err || !res) {
            return cbk([500, 'UnexpectedErrorSendingSmsViaTwilio', {err}]);
          }

          if (res.status !== 200) {
            return cbk([503, 'UnexpectedTwilioSmsStatus', {code: res.status}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
