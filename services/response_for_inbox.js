const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {decodeTlvStream} = require('bolt01');
const {returnResult} = require('asyncjs-util');

const {executeInboxAction} = require('./../actions');
const {isEmailConfigured} = require('./../config');
const {isSmsConfigured} = require('./../config');

const asString = value => Buffer.from(value, 'hex').toString('utf8');
const deliveredText = 'Message delivered to inbox!';
const findMessage = records => records.find(n => n.type === '0');
const findReplyTo = records => records.find(n => n.type === '1');
const free = '0';
const matchNumber = /^[1-9]\d{0,14}$/;
const paywallText = 'Pay to deliver your inbox message';

/** Generate a response for an inbox request

  {
    arguments: <Arguments TLV Stream Hex String>
    env: <Environment Variables Object>
    fetch: <Node Fetch Function>
    id: <Request Id Hex String>
    lnd: <Authenticated LND API Object>
  }

  @returns
  {
    [error]: [
      <Error Code Number>
      <Error Code Type String>
    ]
    [response]: {
      [paywall]: <Paywall BOLT 11 Request String>
      text: <Response Text String>
    }
  }
*/
module.exports = ({arguments, env, fetch, id, lnd}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!arguments) {
          return cbk([400, 'ExpectedServiceRequestArgumentsForPaidInbox']);
        }

        // Check that the arguments are a valid TLV stream
        try {
          decodeTlvStream({encoded: arguments});
        } catch (err) {
          return cbk([400, 'ExpectedTlvStreamArgumentsForInboxService']);;
        }

        if (!env) {
          return cbk([400, 'ServerConfigurationMissingForInboxService']);
        }

        if (!isEmailConfigured({env}) && !isSmsConfigured({env})) {
          return cbk([404, 'InboxServiceNotSupported']);
        }

        if (!fetch) {
          return cbk([400, 'ExpecedFetchFunctionForInboxService']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndForInboxService']);
        }

        return cbk();
      },

      // Create a paywall invoice to trigger sending the message when paid
      paywall: ['validate', ({}, cbk) => {
        const price = env.PAID_SERVICES_INBOX_PRICE;

        // Exit early when there is no paywall configured
        if (!price || price === free) {
          return cbk();
        }

        if (!matchNumber.test(price)) {
          return cbk([500, 'InvalidServerConfigurationOfInboxPrice']);
        }

        // Create the paywall invoice
        return createInvoice({
          lnd,
          description_hash: id,
          tokens: Number(price),
        },
        cbk);
      }],

      // Execute the inbox action to deliver the message
      execute: ['paywall', ({paywall}, cbk) => {
        // Exit early when a paywall prevents completing the inbox
        if (!!paywall) {
          return cbk();
        }

        return executeInboxAction({arguments, env, fetch}, cbk);
      }],

      // Final response to return
      response: ['execute', 'paywall', ({paywall}, cbk) => {
        const text = !paywall ? deliveredText : paywallText;

        // Exit early with a payment request when there is a paywall block
        if (!!paywall) {
          return cbk(null, {response: {text, paywall: paywall.request}});
        }

        return cbk(null, {response: {text}});
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
