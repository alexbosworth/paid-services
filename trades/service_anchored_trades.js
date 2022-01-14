const EventEmitter = require('events');

const asyncUntil = require('async/until');
const {getInvoices} = require('ln-service');
const {subscribeToInvoice} = require('ln-service');
const {subscribeToInvoices} = require('ln-service');

const decodeAnchoredTrade = require('./decode_anchored_trade');
const serviceTradeRequests = require('./service_trade_requests');
const tradeFromInvoice = require('./trade_from_invoice');

const defaultInvoicesLimit = 100;
const events = ['details', 'error', 'failure', 'settled', 'trade'];
const fromNow = date => new Date(date) - new Date();
const {keys} = Object;

/** Service trades represented by anchored invoices

  {
    lnd: <Authenticated LND API Object>
  }

  // Returned details
  @event 'details'
  {
    to: <Public Key Id Hex String>
  }

  // Terminal failure
  @event 'error'
  <Error Object>

  // Encountered a failure
  @event 'failure'
  [<Failure Code Number>, <Failure Code String>]

  // Received payment
  @event 'settled'
  {
    description: <Trade Description String>
    id: <Trade Id Hex String>
    secret: <Secret Payload String>
    to: <Public Key Id Hex String>
    tokens: <Tokens Number>
  }

  // Starting service for trade
  @event 'start'
  {
    description: <Trade Description String>
    expires_at: <Trade Expires at ISO 8601 Date String>
    id: <Trade Id Hex String>
    secret: <Secret Payload String>
    tokens: <Tokens Number>
  }

  // Return finalized trade
  @event 'trade'
  {
    to: <Public Key Id Hex String>
  }

  @returns
  <EventEmitter Object>
*/
module.exports = ({lnd}) => {
  const emitter = new EventEmitter();
  const listening = {};
  const paging = {};

  // Service a trade until it's paid or canceled
  const serviceTrade = trade => {
    // Exit early when already listening to this trade
    if (!!listening[trade.id]) {
      return;
    }

    const sub = serviceTradeRequests({
      lnd,
      description: trade.description,
      expires_at: trade.expires_at,
      id: trade.id,
      secret: trade.secret,
      tokens: trade.tokens,
    });

    // Pick up the trade to service
    emitter.emit('start', {
      description: trade.description,
      expires_at: trade.expires_at,
      id: trade.id,
      secret: trade.secret,
      tokens: trade.tokens,
    });

    // Settled a trade
    sub.on('settled', ({to}) => {
      return emitter.emit('settled', {
        to,
        id: trade.id,
        description: trade.description,
        secret: trade.secret,
        tokens: trade.tokens,
      });
    });

    // Remember this listener to avoid double-listening to the same trade
    listening[trade.id] = sub;

    sub.on('details', ({to}) => emitter.emit('details', {to, id: trade.id}));
    sub.on('failure', err => emitter.emit('failure', {err, id: trade.id}));
    sub.on('trade', ({to}) => emitter.emit('trade', {to, id: trade.id}));

    sub.once('end', () => sub.removeAllListeners());

    const invoiceUpdates = subscribeToInvoice({lnd, id: trade.id});

    invoiceUpdates.on('invoice_updated', updated => {
      if (!updated.is_canceled) {
        return;
      }

      return invoiceUpdates.removeAllListeners();
    });

    return;
  };

  // Listen for any new invoices that represent anchored trades
  const sub = subscribeToInvoices({lnd});

  // Listen for new trades to appear
  sub.on('invoice_updated', invoice => {
    const {trade} = tradeFromInvoice(invoice);

    // Exit early when there is no anchored trade found in the description
    if (!trade) {
      return;
    }

    return serviceTrade(trade);
  });

  // Find open anchored trades
  asyncUntil(
    cbk => cbk(null, paging.token === false),
    cbk => {
      return getInvoices({
        lnd,
        is_unconfirmed: true,
        limit: !paging.token ? defaultInvoicesLimit : undefined,
        token: paging.token,
      },
      (err, res) => {
        if (!!err) {
          emitter.emit(err);

          // Stop listening to all invoices
          sub.removeAllListeners();

          // Stop listening to all anchor invoices
          keys(listening).forEach(id => listening[id].removeAllListeners());

          return;
        }

        paging.token = res.next || false;

        res.invoices
          .map(tradeFromInvoice)
          .map(n => n.trade)
          .filter(n => !!n)
          .forEach(serviceTrade);

        return cbk();
      });
    }
  );

  return emitter;
};
