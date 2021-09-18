const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {getInvoice} = require('ln-service');
const {parsePaymentRequest} = require('invoices');
const {returnResult} = require('asyncjs-util');

const invoiceAsRequest = require('./invoice_as_request');

const attempt = (m, n) => { try { return m(n); } catch (e) { return {}; } };

/** Get a paid service request if there is one present

  This allows for passing a paid service request by its invoice or paywall id.

  {
    env: <Environment Variables Object>
    id: <Invoice Id Hex String>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
  }

  @returns via cbk or Promise
  {
    [error]: [
      <Error Number>
      <Error Type String>
    ]
    [node]: <Response For Node Id Public Key Hex String>
    [paywall]: <Required Payment to BOLT 11 Paywall Request String>
    [request]: <BOLT 11 Encoded Respond Payment Request String>
    [service]: {
      [arguments]: <TLV Stream Arguments Hex String>
      type: <Request Type Number>
      version: <Request Paid Services Version Number>
    }
  }
*/
module.exports = ({env, id, lnd, network}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvironmentVarsToGetServiceRequest']);
        }

        if (!id) {
          return cbk([400, 'ExpectedInvoiceIdToGetServiceRequest']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetServiceRequest']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameStringToGetServiceRequest']);
        }

        return cbk();
      },

      // Get the invoice by the id. This invoice is expected to be present
      getReference: ['validate', ({}, cbk) => getInvoice({id, lnd}, cbk)],

      // Lookup the original invoice if the id is a paywall id
      getParent: ['getReference', ({getReference}, cbk) => {
        // Exit early when the reference invoice is not a regular payment
        if (!!getReference.is_push) {
          return cbk(null, {});
        }

        // A description hash pointer would point to the parent invoice
        if (!getReference.description_hash) {
          return cbk(null, {});
        }

        // The id of the original service request is in the paywall desc/hash
        const id = getReference.description_hash;

        // Look for the parent service request
        return getInvoice({id, lnd}, (error, value) => {
          return cbk(null, {error, value});
        });
      }],

      // The paid request invoice will either be the id or the parent
      paidServiceInvoice: [
        'getParent',
        'getReference',
        ({getParent, getReference}, cbk) =>
      {
        // Exit early when there is a parent invoice, this would be the push
        if (!!getParent.value) {
          return cbk(null, getParent.value);
        }

        return cbk(null, getReference);
      }],

      // Map the invoice details to a paid service request
      invoiceAsRequest: [
        'getParent',
        'getReference',
        'paidServiceInvoice',
        ({getParent, getReference, paidServiceInvoice}, cbk) =>
      {
        try {
          const paid = invoiceAsRequest({
            network,
            is_confirmed: paidServiceInvoice.is_confirmed,
            is_push: paidServiceInvoice.is_push,
            payments: paidServiceInvoice.payments,
          });

          // Exit early when there is no related reply request
          if (!paid.request) {
            return cbk(null, {});
          }

          const {destination} = attempt(parsePaymentRequest, {
            request: paid.request,
          });

          // A paywall invoice has the parent push as its description hash
          const isPaywall = !!getParent && !!getParent.value;

          return cbk(null, {
            error: paid.error,
            node: destination,
            paywall: !!isPaywall ? getReference.request : undefined,
            request: paid.request,
            service: paid.service,
          });
        } catch (err) {
          return cbk(null, {});
        }
      }],
    },
    returnResult({reject, resolve, of: 'invoiceAsRequest'}, cbk));
  });
};
