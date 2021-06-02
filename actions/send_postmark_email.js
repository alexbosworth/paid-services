const {callbackify} = require('util');

const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const acceptTypeAttribute = 'Accept';
const contentType = 'application/json';
const contentTypeAttribute = 'Content-Type';
const emailApi = 'https://api.postmarkapp.com/email';
const messageStream = 'outbound';
const method = 'post';
const postmarkKeyAttribute = 'X-Postmark-Server-Token';
const {stringify} = JSON;

/** Send an email using postmark email API

  {
    fetch: <Node Fetch Function>
    from: <From Address String>
    key: <Postmark API Key String>
    subject: <Subject String>
    text: <Body Text String>
    to: <To Address String>
  }

  @returns via cbk or Promise
*/
module.exports = ({fetch, from, key, subject, text, to}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToSendPostmarkEmail']);
        }

        if (!from) {
          return cbk([400, 'ExpectedFromEmailToSendPostmarkEmail']);
        }

        if (!key) {
          return cbk([400, 'ExpectedPostmarkApiKeyToSendEmail']);
        }

        if (!subject) {
          return cbk([400, 'ExpectedSubjectToSendEmail']);
        }

        if (!text) {
          return cbk([400, 'ExpectedTextToSendPostmarkEmail']);
        }

        if (!to) {
          return cbk([400, 'ExpectedToAddressToSendPostmarkEmail']);
        }

        return cbk();
      },

      // Send the email
      send: ['validate', ({}, cbk) => {
        return callbackify(fetch)(emailApi, {
          method,
          body: stringify({
            From: from,
            MessageStream: messageStream,
            Subject: subject,
            TextBody: text,
            To: to,
          }),
          headers: {
            [acceptTypeAttribute]: contentType,
            [contentTypeAttribute]: contentType,
            [postmarkKeyAttribute]: key,
          },
        },
        err => {
          if (!!err) {
            return cbk([500, 'UnexpectedErrorPostingEmailToPostmark', {err}]);
          }

          return cbk();
        });
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
