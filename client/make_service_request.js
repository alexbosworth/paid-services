const {randomBytes} = require('crypto');

const asyncAuto = require('async/auto');
const {createInvoice} = require('ln-service');
const {payViaRoutes} = require('ln-service');
const {probeForRoute} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const {invoiceNetwork} = require('./../config');
const messagesAsResponse = require('./messages_as_response');
const messagesForRequest = require('./messages_for_request');
const waitForResponse = require('./wait_for_response');

const defaultCltvDelta = 144;
const defaultMaxFeeMtokens = '9000';
const defaultRequestMtokens = '10000';
const findResponse = messages => messages.find(n => n.type === '805805');
const makeSecret = () => randomBytes(32).toString('hex');
const maxPathfindingTimeMs = 1000 * 60 * 5;
const waitForResponseMs = 1000 * 60 * 10;

/** Make a service request

  {
    [arguments]: <TLV Encoded Hex String>
    id: <Service Id Number String>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    node: <Node Public Key Hex String>
    [secret]: <Push Preimage Hex String>
  }

  @returns via cbk or Promise
  {
    [links]: [<URL String>]
    [paywall]: <BOLT 11 Payment Request String>
    [nodes]: [<Node Public Key Hex String>]
    [records]: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
    [text]: <Response Message String>
  }
*/
module.exports = ({arguments, id, lnd, network, node, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!id) {
          return cbk([400, 'ExpectedServiceIdNumberToMakeServiceRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToMakeServiceRequest']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToMakeServiceRequest']);
        }

        if (!node) {
          return cbk([400, 'ExpectedNodePublicKeyToMakeServiceRequest']);
        }

        return cbk();
      },

      // Create a reply invoice that the service will pay back to
      createReply: ['validate', ({}, cbk) => createInvoice({lnd}, cbk)],

      // Derive messages for the service request
      requestMessages: ['createReply', ({createReply}, cbk) => {
        try {
          return cbk(null, messagesForRequest({
            arguments,
            reply: createReply.request,
            secret: secret || makeSecret(),
            service: id,
          }));
        } catch (err) {
          return cbk([400, 'FailedToEncodeMessagesForRequest', {err}]);
        }
      }],

      // Listen for a reply to the invoice
      response: ['createReply', ({createReply}, cbk) => {
        return waitForResponse({
          lnd,
          id: createReply.id,
          ms: waitForResponseMs,
        },
        (error, value) => {
          return cbk(null, {error, value});
        });
      }],

      // Find a route to make a payment
      findRoute: ['requestMessages', ({requestMessages}, cbk) => {
        return probeForRoute({
          lnd,
          cltv_delta: defaultCltvDelta,
          destination: node,
          max_fee_mtokens: defaultMaxFeeMtokens,
          messages: requestMessages.messages,
          mtokens: defaultRequestMtokens,
          probe_timeout_ms: maxPathfindingTimeMs,
        },
        cbk);
      }],

      // Make the push payment
      push: [
        'findRoute',
        'requestMessages',
        ({findRoute, requestMessages}, cbk) =>
      {
        // Exit early when not using find route
        if (!findRoute) {
          return cbk();
        }

        if (!findRoute.route) {
          return cbk([503, 'FailedToFindRouteToDestination']);
        }

        return payViaRoutes({
          lnd,
          id: requestMessages.id,
          routes: [findRoute.route],
        },
        cbk);
      }],

      // Decode the server response
      decode: ['response', 'push', ({push, response}, cbk) => {
        // Exit early when there was an error with the server response
        if (!!response.error) {
          const [code, message] = response.error;

          return cbk([code, message, {paid: push.tokens}]);
        }

        const {payments} = response.value;

        // One of the HTLCs will have the response record encoded
        const payment = payments.find(n => findResponse(n.messages));

        if (!payment) {
          return cbk([503, 'FailedToReceivePaidServiceResponseFromServer']);
        }

        const {messages} = payment;

        try {
          return cbk(null, messagesAsResponse({
            messages,
            network: invoiceNetwork[network],
          }));
        } catch (err) {
          return cbk([503, 'UnexpectedErrorParsingServiceResponse', {err}]);
        }
      }],

      // Final response from the server
      service: ['decode', ({decode}, cbk) => {
        // Exit early when the service returned an error
        if (!!decode.error) {
          return cbk(decode.error);
        }

        return cbk(null, {
          links: decode.links,
          nodes: decode.nodes,
          paywall: decode.paywall,
          records: decode.records,
          text: decode.text,
        });
      }],
    },
    returnResult({reject, resolve, of: 'service'}, cbk));
  });
};
