const EventEmitter = require('events');
const {randomBytes} = require('crypto');

const {acceptsChannelOpen} = require('ln-sync');
const {getInvoice} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');

const acceptTrade = require('./accept_trade');
const finalizeTradeSecret = require('./finalize_trade_secret');
const {makePeerRequest} = require('./../p2p');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeReceiveChannelSale} = require('./../service_types');
const {serviceTypeRequestChannelSale} = require('./../service_types');
const {serviceTypeRequestTrades} = require('./../service_types');
const {serviceTypeReceiveTrades} = require('./../service_types');

const descRecord = description => ({type: '2', value: description});
const events = ['details', 'end', 'failure', 'settled', 'trade'];
const findIdRecord = records => records.find(n => n.type === '0');
const findRequestIdRecord = records => records.find(n => n.type === '1');
const hashHexLength = 64;
const idBackType = '0';
const idRecord = id => ({type: '1', value: id});
const msRemainingToTime = time => time - Date.now();
const postOpenTradeTimeoutMs = 1000 * 30;
const sellAction = 'sell';
const sumOf = arr => arr.reduce((sum, n) => sum + n, 0);
const tradeSecretType = '1';
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Service requests for an open trade

  The maximum expiration date is three weeks

  {
    action: <Trade Action String>
    description: <Trade Description String>
    expires_at: <Trade Expires At ISO 8601 Date String>
    id: <Trade Id Hex String>
    lnd: <Authenticated LND API Object>
    logger: <Winston Logger Object>
    request: <Request Function>
    secret: <Secret Payload String>
    tokens: <Tokens Number or Fiat>
  }

  // Return details
  @event 'details'
  {
    to: <Public Key Id Hex String>
  }

  // Service ended
  @event 'end'

  // Encountered a failure
  @event 'failure'
  [<Failure Code Number>, <Failure Code String>]

  // Received payment
  @event 'settled'
  {
    to: <Public Key Id Hex String>
  }

  // Return finalized trade
  @event 'trade'
  {
    to: <Public Key Id Hex String>
  }

  @returns
  <Service Event Emitter Object>
*/
module.exports = args => {
  if (!args.description) {
    throw new Error('ExpectedTradeDescriptionToServiceTradeRequests');
  }

  if (!args.id) {
    throw new Error('ExpectedTradeIdToServiceTradeRequests');
  }

  if (args.id.length !== hashHexLength) {
    throw new Error('ExpectedShorterRequestIdValueToServiceTradeRequests');
  }

  if (!args.lnd) {
    throw new Error('ExpectedAuthenticatedLndToServiceTradeRequests');
  }

  if (!args.request) {
    throw new Error('ExpectedRequestFunctionToServiceTradeRequests');
  }

  if (!args.secret) {
    throw new Error('ExpectedSecretToEncryptToServiceTradeRequests');
  }

  if (!args.tokens) {
    throw new Error('ExpectedTokensPriceForTradeToServiceTradeRequests');
  }

  const emitter = new EventEmitter();

  const holds = [];
  const service = servicePeerRequests({lnd: args.lnd});

  // Stop the service when there are no more listeners
  emitter.on('removeListener', () => {
    // Exit early when there are still listeners on an event
    if (!!sumOf(events.map(n => emitter.listenerCount(n)))) {
      return;
    }

    return service.stop({});
  });

  const sub = subscribeToInvoice({id: args.id, lnd: args.lnd});

  sub.on('invoice_updated', invoice => {
    if (!invoice.is_canceled) {
      return;
    }

    holds.forEach(n => n.sub.removeAllListeners());

    return service.stop({});
  });

  // Notify when the service ends
  service.end(() => emitter.emit('end', {}));

  // Basic trade description
  const basicTradeRecords = [
    idRecord(args.id),
    descRecord(utf8AsHex(args.description)),
  ];

  const requestType = !!args.action ?
    serviceTypeRequestChannelSale :
    serviceTypeRequestTrades;

  // Wait for a request for the open trade
  service.request({type: requestType}, (req, res) => {
    const {failure, success} = res;
    const requestTradeId = findIdRecord(req.records);

    // Exit early when the trade requested is unrelated
    if (!!requestTradeId && requestTradeId.value !== args.id) {
      return;
    }

    const requestIdRecord = findRequestIdRecord(req.records);

    // A trade request either is for a specific trade or has a pingback id
    if (!requestTradeId && !requestIdRecord) {
      return emitter.emit('failure', [400, 'ExpectedRequestTradeOrRequestId']);
    }

    // Exit early when the trade is expired
    if (args.expires_at < new Date().toISOString()) {
      service.stop({});

      return;
    }

    // Exit early and ping peer with trade when this is an open ended query
    if (!requestTradeId) {
      emitter.emit('details', {to: req.from});

      const reqIdRecord = {type: idBackType, value: requestIdRecord.value};

      const records = [].concat(basicTradeRecords).concat(reqIdRecord);

      return getInvoice({id: args.id, lnd: args.lnd}, (err, res) => {
        if (!!err || !!res.is_canceled) {
          return;
        }

        const receiveType = args.action === sellAction ?
          serviceTypeReceiveChannelSale :
          serviceTypeReceiveTrades;

        // Ping the node with trade details
        return makePeerRequest({
          records,
          lnd: args.lnd,
          timeout: postOpenTradeTimeoutMs,
          to: req.from,
          type: receiveType,
        },
        err => {
          if (!!err) {
            failure([503, 'FailedToDeliverTradeInfo']);

            return emitter.emit(
              'failure',
              [503, 'FailedToDeliverTradeInfo', {err}]
            );
          }

          return success({});
        });
      });
    }

    // Make a finalized trade secret for the peer
    emitter.emit('trade', ({to: req.from}));

    // Create a trade secret for the requesting peer and return that
    return finalizeTradeSecret({
      action: args.action,
      description: args.description,
      expires_at: args.expires_at,
      is_hold: true,
      lnd: args.lnd,
      logger: args.logger,
      request: args.request,
      secret: args.secret,
      to: req.from,
      tokens: args.tokens,
    },
    (err, res) => {
      if (!!err) {
        emitter.emit('failure', err);

        return failure([503, 'FailedToFinalizeTradeSecret']);
      }

      // Create a record for the encoded trade
      const record = {type: tradeSecretType, value: res.trade};

      // Add hold invoice to set of held invoices, only one should settle
      const sub = subscribeToInvoice({id: res.id, lnd: args.lnd});

      // Add sub to list of holds
      holds.push({sub, id: res.id});

      // Wait for the invoice to be paid
      sub.on('invoice_updated', updated => {
        // Exit early when the payment is not held yet
        if (!updated.is_held) {
          return;
        }

        // Do not accept any more bids
        service.stop({});

        // Stop listening to invoice events
        holds.forEach(hold => hold.sub.removeAllListeners());

        // Settle the held invoice with the preimage
        return acceptTrade({
          action: args.action,
          capacity: args.capacity,
          cancel: holds.filter(n => n.id !== updated.id).map(n => n.id),
          id: args.id,
          lnd: args.lnd,
          logger: args.logger,
          partner_public_key: req.from,
          secret: res.secret,
        },
        err => {
          if (!!err) {
            return emitter.emit('failure', err);
          }

          emitter.emit('settled', {to: req.from});

          return emitter.emit('end', {});
        });
      });

      // Exit early on channel sale, confirming acceptance
      if (args.action === sellAction) {
        return acceptsChannelOpen({
          capacity: args.capacity,
          lnd: args.lnd,
          partner_public_key: req.from,
        },
        err => {
          if (!!err) {
            return failure([503, 'FailedToAcceptChannelOpen', {err}]);
          }

          // Return details about the trade
          return success({records: [record]});
        });
      }

      // Return details about the trade
      return success({records: [record]});
    });
  });

  return emitter;
};
