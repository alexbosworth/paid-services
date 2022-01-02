const EventEmitter = require('events');
const {randomBytes} = require('crypto');

const {subscribeToInvoice} = require('ln-service');

const acceptTrade = require('./accept_trade');
const finalizeTradeSecret = require('./finalize_trade_secret');
const {makePeerRequest} = require('./../p2p');
const {servicePeerRequests} = require('./../p2p');
const {serviceTypeRequestTrades} = require('./../service_types');
const {serviceTypeReceiveTrades} = require('./../service_types');

const descRecord = description => ({type: '2', value: description});
const findIdRecord = records => records.find(n => n.type === '0');
const findRequestIdRecord = records => records.find(n => n.type === '1');
const idBackType = '0';
const idRecord = id => ({type: '1', value: id});
const makeEphemeralTradeId = () => randomBytes(32).toString('hex');
const postOpenTradeTimeoutMs = 1000 * 30;
const tradeSecretType = '1';
const utf8AsHex = utf8 => Buffer.from(utf8).toString('hex');

/** Service requests for an open trade

  {
    description: <Trade Description String>
    lnd: <Authenticated LND API Object>
    secret: <Secret Payload String>
    tokens: <Tokens Number>
  }

  // Service ended
  @event 'end'

  // Encountered a failure
  @event 'failure'
  [<Failure Code Number>, <Failure Code String>]

  // Return details
  @event 'details'
  {
    to: <Public Key Id Hex String>
  }

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
module.exports = ({description, lnd, secret, tokens}) => {
  const emitter = new EventEmitter();

  const holds = [];
  const id = makeEphemeralTradeId();
  const service = servicePeerRequests({lnd});

  // Notify when the service ends
  service.end(() => emitter.emit('end', {}));

  // Basic trade description
  const basicTradeRecords = [idRecord(id), descRecord(utf8AsHex(description))];

  // Wait for a request for the open trade
  service.request({type: serviceTypeRequestTrades}, (req, res) => {
    const {failure, success} = res;
    const requestTradeId = findIdRecord(req.records);

    // Exit early when the trade requested is unrelated
    if (!!requestTradeId && requestTradeId.value !== id) {
      return;
    }

    const requestIdRecord = findRequestIdRecord(req.records);

    // A trade request either is for a specific trade or has a pingback id
    if (!requestTradeId && !requestIdRecord) {
      return emitter.emit('failure', [400, 'ExpectedRequestTradeOrRequestId']);
    }

    // Exit early and ping peer with trade when this is an open ended query
    if (!requestTradeId) {
      emitter.emit('details', {to: req.from});

      const reqIdRecord = {type: idBackType, value: requestIdRecord.value};

      const records = [].concat(basicTradeRecords).concat(reqIdRecord);

      // Ping the node with trade details
      return makePeerRequest({
        lnd,
        records,
        timeout: postOpenTradeTimeoutMs,
        to: req.from,
        type: serviceTypeReceiveTrades,
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
    }

    // Make a finalized trade secret for the peer
    emitter.emit('trade', ({to: req.from}));

    // Create a trade secret for the requesting peer and return that
    return finalizeTradeSecret({
      description,
      lnd,
      secret,
      tokens,
      is_hold: true,
      to: req.from,
    },
    (err, res) => {
      if (!!err) {
        emitter.emit('failure', err);

        return failure([503, 'FailedToFinalizeTradeSecret']);
      }

      // Create a record for the encoded trade
      const record = {type: tradeSecretType, value: res.trade};

      // Add hold invoice to set of held invoices, only one should settle
      const sub = subscribeToInvoice({lnd, id: res.id});

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
          lnd,
          cancel: holds.filter(n => n.id !== updated.id).map(n => n.id),
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

      // Return details about the trade
      return success({records: [record]});
    });
  });

  return emitter;
};
