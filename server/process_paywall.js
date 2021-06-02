const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {executeInboxAction} = require('./../actions');
const getServiceRequest = require('./get_service_request');
const {schema} = require('./../services');

/** Perform actions on a paid payment request to fulfill any paywall actions

  {
    env: <Environment Variables Object>
    fetch: <Node Fetch Function>
    id: <Request Id Hex String>
    lnd: <Authenticated LND API Object>
  }
*/
module.exports = ({env, fetch, id, lnd, network}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvironmentVariablesToProcessPaywall']);
        }

        if (!fetch) {
          return cbk([400, 'ExpectedFetchFunctionToProcessPaywallPayment']);
        }

        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdToProcessPaywallRequest']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToProcessPaywallRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedLndToProcessPaywallRequest']);
        }

        return cbk();
      },

      // Get the original service request
      getServiceRequest: ['validate', ({}, cbk) => {
        return getServiceRequest({env, id, lnd, network}, cbk);
      }],

      // Perform the associated action now that the paywall is paid
      performAction: ['getServiceRequest', ({getServiceRequest}, cbk) => {
        if (!getServiceRequest.service) {
          return cbk([400, 'ExpectedServiceRequestAssociatedWithPaywall']);
        }

        const {arguments} = getServiceRequest.service;

        switch (getServiceRequest.service.type) {
        // Perform the inbox action
        case schema.types.inbox:
          return executeInboxAction({arguments, env, fetch}, cbk);

        // No action type for specified service
        default:
          return cbk([404, 'UnknownServiceAssociatedWithPaywall']);
        }
      }],
    },
    returnResult({reject, resolve}, cbk));
  });
};
