const asyncAuto = require('async/auto');
const {parsePaymentRequest} = require('invoices');
const {payViaPaymentDetails} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const messagesForResponse = require('./messages_for_response');

const defaultSendMtokens = '1000';
const maxFeeMtok = (requested, received) => (received - requested).toString();
const pathfindingTimeoutMs = 1000 * 60 * 10;

/** Send a paid service response

  {
    [error]: [
      <Error Code Number>
      <Error Message Type String>
    ]
    [links]: [<URL String>]
    lnd: <Authenticated LND API Object>
    mtokens: <Received Millitokens String>
    [nodes]: [<Node Public Key Hex String>]
    [paywall]: <Response Paywall BOLT 11 Payment Request String>
    [records]: [{
      type: <Record Type Number String>
      value: <Record Type Value Hex String>
    }]
    request: <Response BOLT 11 Payment Request String>
    [text]: <Text Response String>
  }

  @returns via cbk or Promise
*/
module.exports = (args, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        try {
          messagesForResponse({
            error: args.error,
            paywall: args.paywall,
            records: args.records,
            text: args.text,
          });
        } catch (err) {
          return cbk([400, 'ExpectedValidServiceResponseToSend', {err}]);
        }

        if (!args.mtokens) {
          return cbk([400, 'ExpectedMillitokensReceivedToSendResponse']);
        }

        if (!args.request) {
          return cbk([400, 'ExpectedResponsePaymentRequestToSendResponse']);
        }

        try {
          parsePaymentRequest({request: args.request});
        } catch (err) {
          return cbk([400, 'ExpectedValidPaymentRequestToPayResponse']);
        }

        return cbk();
      },

      // Derive payment details
      payment: ['validate', ({}, cbk) => {
        const details = parsePaymentRequest({request: args.request});

        if (!!details.is_expired) {
          return cbk([400, 'ExpectedUnexpiredInvoiceToSendServiceResponse']);
        }

        const mtokens = BigInt(details.mtokens || defaultSendMtokens);

        if (mtokens > BigInt(args.mtokens)) {
          return cbk([400, 'ExpectedPaymentTokensNotGreaterThanReceived']);
        }

        // Encode the response in a paid service record
        const {messages} = messagesForResponse({
          error: args.error,
          links: args.links,
          nodes: args.nodes,
          paywall: args.paywall,
          records: args.records,
          text: args.text,
        });

        return payViaPaymentDetails({
          messages,
          cltv_delta: details.cltv_delta,
          destination: details.destination,
          features: details.features,
          id: details.id,
          lnd: args.lnd,
          max_fee_mtokens: maxFeeMtok(mtokens.toString(), args.mtokens),
          mtokens: mtokens.toString(),
          pathfinding_timeout: pathfindingTimeoutMs,
          payment: details.payment,
          routes: details.routes,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
