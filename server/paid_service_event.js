const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const getServiceRequest = require('./get_service_request');
const processPaywall = require('./process_paywall');
const processRequest = require('./process_request');
const {schema} = require('./../services');

/** Emit a paid service response

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
      <Error Code String>
    ]
    [node]: <Response for Node with Public Key Id Hex String>
    [service]: <Service Name String>
  }
*/
module.exports = ({env, fetch, id, lnd, network, payer}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvironmentVariablesForPaidServiceEvent']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionForPaidServiceEvent']);
        }

        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdForPaidServiceEvent']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndForPaidServiceEvent']);
        }

        if (!payer) {
          return cbk([400, 'ExpectedPayerLndForPaidServiceEvent']);
        }

        return cbk();
      },

      // Get the service request
      getRequest: ['validate', ({}, cbk) => {
        return getServiceRequest({env, id, lnd, network}, cbk);
      }],

      // Process a paywall request
      processPaywall: ['getRequest', ({getRequest}, cbk) => {
        // Exit early when this is not a paywall being paid
        if (!getRequest.paywall) {
          return cbk();
        }

        return processPaywall({env, fetch, id, lnd, network}, cbk);
      }],

      // Process a regular paid service request
      processRequest: ['getRequest', ({getRequest}, cbk) => {
        // Exit early when this is a paywall payment or just not a service req
        if (!!getRequest.paywall || !getRequest.request) {
          return cbk(null, {});
        } 

        return processRequest({env, fetch, id, lnd, network, payer}, cbk);
      }],

      // Lookup the service name
      service: [
        'getRequest',
        'processRequest',
        ({getRequest, processRequest}, cbk) =>
      {
        // Exit early when there is no service
        if (!getRequest.service) {
          return cbk(null, {});
        }

        const {type} = getRequest.service;

        // Service types are numbers but they have names for easier reference
        return cbk(null, {
          error: processRequest.error,
          node: getRequest.node,
          service: schema.ids[type],
        });
      }],
    },
    returnResult({reject, resolve, of: 'service'}, cbk));
  });
};
