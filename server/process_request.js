const asyncAuto = require('async/auto');
const {getInvoice} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const invoiceAsRequest = require('./invoice_as_request');
const {respondToRequest} = require('./../services');
const {sendServiceResponse} = require('./../respond');

/** Process a paid service request

  {
    env: <Environment Variables Object>
    fetch: <Node Fetch Function>
    id: <Invoice Id Hex String>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    payer: <Responding Payer Authenticated LND API Object>
  }

  @returns via cbk or Promise
  {
    [error]: [
      <Error Code Number>
      <Error Message String>
    ]
  }
*/
module.exports = ({env, fetch, id, lnd, network, payer}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvironmentVarsToProcessPaidRequest']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToProcessPaidRequest']);
        }

        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdToProcessPaidRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToProcessPaidRequest']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToProcessPaidRequest']);
        }

        if (!payer) {
          return cbk([400, 'ExpectedPayerLndToProcessPaidRequest']);
        }

        return cbk();
      },

      // Get the paid invoice that contains the request
      getInvoice: ['validate', ({}, cbk) => getInvoice({lnd, id}, cbk)],

      // Map the invoice to a standard paid service request
      paidRequest: ['getInvoice', ({getInvoice}, cbk) => {
        try {
          return cbk(null, invoiceAsRequest({
            network,
            is_confirmed: getInvoice.is_confirmed,
            is_push: getInvoice.is_push,
            payments: getInvoice.payments,
          }));
        } catch (err) {
          return cbk([500, 'UnexpectedErrMappingInvoiceToPaidRequest', {err}]);
        }
      }],

      // Get the service response to the paid service request
      getResponse: ['paidRequest', ({paidRequest}, cbk) => {
        // Exit early when there is a problem with the standard request
        if (!!paidRequest.error) {
          return cbk(null, {});
        }

        return respondToRequest({
          env,
          fetch,
          id,
          lnd,
          arguments: paidRequest.service.arguments,
          type: paidRequest.service.type,
        },
        cbk);
      }],

      // Determine if there is an error to be returned
      responseError: [
        'getResponse',
        'paidRequest',
        ({getResponse, paidRequest}, cbk) =>
      {
        // Exit early when the response has no error
        if (!paidRequest.error && !getResponse.error) {
          return cbk(null, {});
        }

        return cbk(null, {error: paidRequest.error || getResponse.error});
      }],

      // Send the response
      sendResponse: [
        'getInvoice',
        'getResponse',
        'paidRequest',
        'responseError',
        ({getInvoice, getResponse, paidRequest, responseError}, cbk) =>
      {
        const response = getResponse.response || {};

        return sendServiceResponse({
          error: responseError.error,
          links: response.links,
          lnd: payer,
          mtokens: getInvoice.received_mtokens,
          nodes: response.nodes,
          paywall: response.paywall,
          records: response.records,
          request: paidRequest.request,
          text: response.text,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'responseError'}, cbk));
  });
};
