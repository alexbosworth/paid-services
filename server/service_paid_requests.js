const EventEmitter = require('events');

const asyncForever = require('async/forever');
const {subscribeToInvoices} = require('ln-service');

const paidServiceEvent = require('./paid_service_event');
const {settleRelayPayments} = require('./../jobs');
const {validateServerConfig} = require('./../config');

const pollIntervalMs = 1000 * 60 * 60;

/** Service paid service requests

  {
    env: <Environment Variables Object>
    fetch: <Node Fetch Function>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    payer: <Responding Payer Authenticated LND API Object>
  }

  @throws
  <Error>

  @returns
  <Service Responder EventEmitter Object>

  @event 'error'
  <Error Object>

  @event 'failure'
  {
    error: [
      <Error Code Number>
      <Error Type String>
    ]
    [service]: <Service Name String>
  }

  @event 'success'
  {
    mtokens: <Received Millitokens String>
    service: <Service Name String>
  }
*/
module.exports = ({env, fetch, lnd, network, payer}) => {
  const emitter = new EventEmitter();
  let isEnded = false;
  const sub = subscribeToInvoices({lnd});

  validateServerConfig({env});

  // Handle held relay payments
  asyncForever(cbk => {
    if (isEnded) {
      return cbk([503, 'ServiceEnded']);
    }

    return settleRelayPayments({lnd}, () => setTimeout(cbk, pollIntervalMs));
  }, error => {
    return emitter.emit('failure', {error})
  });

  sub.on('error', err => {
    isEnded = true;

    sub.removeAllListeners();

    // Exit early when there are no error listeners
    if (!emitter.listenerCount('error')) {
      return;
    }

    return emitter.emit('error', [503, 'UnexpectedPaidInvoiceSubErr', {err}]);
  });

  // Listen for invoice updates
  sub.on('invoice_updated', updated => {
    // Exit early when there is no payment on the invoice
    if (!updated.is_confirmed) {
      return;
    }

    return paidServiceEvent({
      env,
      fetch,
      lnd,
      network,
      payer,
      id: updated.id,
    },
    (error, res) => {
      if (!!error) {
        return emitter.emit('failure', ({error}));
      }

      const {service} = res;

      // Exit early when this invoice is not related to a service
      if (!service) {
        return;
      }

      const mtokens = updated.received_mtokens;

      // Exit early when there is a failure returned to the user
      if (!!res.error) {
        return emitter.emit('failure', ({service, error: res.error}));
      }

      return emitter.emit('success', ({service, received: mtokens}));
    });
  });

  return emitter;
};
