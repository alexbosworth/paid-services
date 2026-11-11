const {mock} = require('node:test');

const asyncMap = require('async/map');
const {blindedPathFromHops} = require('bolt04');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {getInvoice} = require('ln-service');
const {makeLnd} = require('mock-lnd');
const {makeOnionMessage} = require('mock-lnd');
const {payInvoice} = require('mock-lnd');
const {pointFromScalar} = require('tiny-secp256k1');

const createMenuRequest = require('./../../../support/create_menu_request');
const {derivedKeyFamily} = require('./../../../support/constants');
const encodeRecord = require('./../../../support/encode_support_record');
const {episode} = require('./service_support_offer');
const {guest} = require('./service_support_offer');
const {makeOffer} = require('./service_support_offer');
const network = require('./../../../network');
const {offer} = require('./service_support_offer');
const {path} = require('./service_support_offer');
const {recordKeyFamily} = require('./../../../service_records/constants');
const recordPoint = require('./../../../service_records/record_point');
const {request} = require('./service_support_offer');
const supportNoteFor = require('./../../../support/support_note_for_invoice');
const {tip} = require('./service_support_offer');

const {assign} = Object;
const bufferAsHex = buffer => buffer.toString('hex');
const elapsedMs = start => msNow() - start;
const isLoopBusy = () => process.getActiveResourcesInfo().some(isWaiting);
const isWaiting = type => type === 'Immediate' || type === 'Timeout';
const largeOnionBytes = 32834;
const maxSettleMs = 5000;
const menuPayerKey = '03462779ad4aad39514614751a71085f2f10e1c7a593e4e030efb5b8721ce55b0b';
const msNow = () => performance.now();
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const pathId = '01'.repeat(32);
const payerKey = '024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
const peer = '02989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f';
const recordKey = '10cff2d5d00662949d667fbd2f6e6e98c1c74f91623e3ead060f3e9557de877c';
const secret = Buffer.alloc(32, 1);
const {serviceNetworkMessages} = network;

// The stream of messages is subscribed to again quickly after it fails
mock.method(network, 'serviceNetworkMessages', args => {
  return serviceNetworkMessages({...args, delay: 1});
});

const method = require('./../../../support/service_support_offer');

// Get the public key of a secret of 32 bytes of a number
const asKey = n => {
  return Buffer.from(pointFromScalar(Buffer.alloc(32, n))).toString('hex');
};

// Make a request from a payer for a page of the menu of an offer
const makeMenuRequest = ({page, to} = {}) => createMenuRequest({
  page,
  offer: to || offer,
  secret: Buffer.alloc(32, 4).toString('hex'),
})
.encoded;

// Make a request without an amount, which cannot be signed
const makeAmountlessRequest = () => {
  const unsigned = createUnsignedInvoiceRequest({
    offer,
    mtokens: '1000',
    network: 'regtest',
    payer_id: asKey(4),
  });

  // Take the amount out of the request
  const {records} = decodeTlvStream({encoded: unsigned.encoded});

  return encodeTlvStream({records: records.filter(n => n.type !== '82')})
    .encoded;
};

// A payer note record of a number of bytes
const payerNote = bytes => ({type: '89', value: '61'.repeat(bytes)});

// A payer offer record of a number of bytes
const payerOffer = bytes => ({
  type: '2000805807',
  value: encodeTlvStream({records: [{type: '1', value: '00'.repeat(bytes)}]})
    .encoded,
});

// Make an onion message with a request on the offer path, with a reply path
// through hops, which starts at the first hop
const makeReceivedOver = ({hops, isLarge, value}) => {
  const [hop] = path.path;
  const [introduction] = hops;

  const reply = blindedPathFromHops({hops});

  return makeOnionMessage({
    encrypted: hop.encrypted_data,
    key: path.key,
    message: {value, type: '64'},
    onion: !isLarge ? undefined : '00'.repeat(largeOnionBytes),
    reply: {
      inbound: reply.path,
      introduction_node: introduction,
      key: reply.key,
    },
    via: peer,
  });
};

// Make an onion message with a request on the offer path, with a reply path
// of a number of hops through the peer
const makeReceived = (value, replyHops, isLarge) => makeReceivedOver({
  isLarge,
  value,
  hops: Array(replyHops || 1).fill(peer),
});

// The calls of a fake LND to a method that did not fail
const callsTo = (lnd, method) => {
  return lnd.calls.filter(n => n.method === method && !n.err);
};

// The newest stream of a fake LND for a method
const streamOf = (lnd, method) => {
  const [call] = lnd.calls.filter(n => n.method === method).slice(-1);

  return call.subscription;
};

// Make a fake LND of the node, connected to the peer that it has a channel
// with for blinded payment paths, which signs with the issuer key of the
// offer. Invoices are put in `held` until they are finished, and fail unless
// the node is paying, and `on_invoice` is told when an invoice starts to be
// made. Signing stops after a number of signatures when there is a number.
const makeTestLnd = args => {
  const lnd = makeLnd({
    channels: [{partner_public_key: peer}],
    keys: [
      {
        family: derivedKeyFamily,
        index: 0,
        secret: args.issuer_secret || Buffer.alloc(32, 5).toString('hex'),
      },
      // The record key of the node is its node key
      {family: recordKeyFamily, index: 0, secret: secret.toString('hex')},
    ],
    network: 'regtest',
    peers: [{public_key: peer}],
    secret: secret.toString('hex'),
  });

  const {addInvoice} = lnd.default;
  const {signMessage} = lnd.signer;

  lnd.default.addInvoice = (request, cbk) => {
    if (!!args.on_invoice) {
      args.on_invoice();
    }

    // The invoice is made, and is held until it is finished
    return addInvoice(request, (err, res) => args.held.push(() => {
      return !args.is_paying ? cbk({details: 'failed'}) : cbk(err, res);
    }));
  };

  lnd.signer.signMessage = (request, cbk) => {
    // Exit early when there are no more signatures
    if (callsTo(lnd, 'signMessage').length === args.signs) {
      return cbk({details: 'failed'});
    }

    return signMessage(request, cbk);
  };

  return lnd;
};

// Let the service finish what it started. Callbacks waiting on the event loop
// run first, then the invoices being made are finished one at a time, oldest
// first, as making an invoice is slower than anything else the service does.
const settle = async ({held, start}) => {
  // Give the service a turn of the event loop
  await nextTurn();

  // Exit with an error when the service does not finish its work
  if (elapsedMs(start) > maxSettleMs) {
    throw new Error('ExpectedServiceToFinishItsWork');
  }

  // Keep going while timers or callbacks are waiting to run
  if (isLoopBusy()) {
    return await settle({held, start});
  }

  const finish = held.shift();

  // Exit early when there is nothing left to do
  if (!finish) {
    return;
  }

  // Finish making the oldest invoice, so the service can use it
  finish();

  return await settle({held, start});
};

// Make a support service record, as this node would make it
const makeRecord = overrides => encodeRecord({
  offer,
  key: recordKey,
  key_index: 0,
  path_ids: [pathId],
  record_key_index: 0,
  ...overrides,
}).record;

// Arguments of the test harness that are not arguments of the service
const harnessOptions = [
  'is_losing_invoices',
  'is_paying',
  'is_stopping_at_start',
  'is_stopping_on_check',
  'is_stopping_on_invoice',
  'issuer_secret',
  'signs',
  'steps',
  'throwing',
];

// Start the service and give it messages at times, then summarize what it did
const serve = async args => {
  // Invoices being made are held, and are finished after everything else
  const held = [];

  // The service can be stopped while an invoice is being made for a request
  const lnd = makeTestLnd({
    held,
    is_paying: args.is_paying,
    issuer_secret: args.issuer_secret,
    on_invoice: () => !!args.is_stopping_on_invoice && service.stop({}),
    signs: args.signs,
  });

  // The options of the test harness are not options of the service
  const options = {...args};

  harnessOptions.forEach(n => delete options[n]);

  const errors = [];
  const invoiceErrors = [];
  const isEnded = [];
  const menus = [];
  const {now} = Date;
  const sent = [];
  const started = [];
  const supporters = [];

  const service = method({lnd, record: makeRecord({}), ...options});

  // A listener can throw after it is told about an event
  const listen = (eventName, cbk) => service[eventName](n => {
    cbk(n);

    if ((args.throwing || []).includes(eventName)) {
      throw new Error('ListenerFailed');
    }
  });

  listen('end', () => isEnded.push(true));
  listen('error', ([code, message]) => errors.push([code, message]));
  listen('invoice', n => sent.push(n));
  listen('invoice_error', n => invoiceErrors.push(n));
  listen('menu', menu => menus.push(menu));
  listen('supporter', n => supporters.push([n.id, n.mtokens, n.payer_id]));

  // The start listener is told the offer, before any invoice is sent
  listen('start', n => started.push([n.offer, sent.length]));

  // The service can be stopped before its record is checked
  if (!!args.is_stopping_at_start) {
    service.stop({});
  }

  // The service can be stopped once its record is checked, before it is
  // told that it started
  if (!!args.is_stopping_on_check) {
    process.nextTick(() => service.stop({}));
  }

  // LND can deny the invoices subscription before the record is checked
  if (!!args.is_losing_invoices) {
    streamOf(lnd, 'subscribeInvoices').emit('error', {
      code: 7,
      details: 'permission denied',
    });
  }

  // Each step moves the clock hours ahead, can fail the stream of messages,
  // as when the connection to LND drops, then pays invoices that were made,
  // by the order they were made in, and gives messages on the newest stream
  for (const step of args.steps || [{}]) {
    assign(Date, {now: () => now() + 1000 * 60 * 60 * (step.hours || 0)});

    if (!!step.is_failing) {
      streamOf(lnd, 'subscribeOnionMessages').emit('error', {
        code: 14,
        details: 'read ECONNRESET',
      });
    }

    (step.paid || []).forEach(index => payInvoice({index, lnd}));

    const current = streamOf(lnd, 'subscribeOnionMessages');

    (step.received || []).forEach(n => current.emit('data', n));

    // The service finishes what the step started before the next step
    await settle({held, start: msNow()});
  }

  assign(Date, {now});

  service.stop({});

  // The invoices that were sent, which have their preimages
  const invoices = await asyncMap(sent, async ({id}) => {
    return await getInvoice({id, lnd});
  });

  const made = callsTo(lnd, 'addInvoice').map(n => n.response);

  // Invoices are named by the order that the node made them in
  const nameOf = id => {
    const invoice = made.find(n => bufferAsHex(n.r_hash) === id);

    return !invoice ? id : invoiceId(invoice.add_index);
  };

  // The note of an invoice is opened with the preimage it is paid with
  const noteOf = (n, i) => supportNoteFor({
    invoice: n.invoice,
    preimage: invoices[i].secret,
  })
  .note;

  return {
    errors,
    menus,
    supporters: supporters.map(([id, ...n]) => [nameOf(id)].concat(n)),
    invoice_errors: invoiceErrors.map(n => {
      return [n.erroneous_field, n.message, n.payer_id];
    }),
    invoices: lnd.calls.filter(n => n.method === 'addInvoice').length,
    is_ended: !!isEnded.length,
    record_keys: callsTo(lnd, 'deriveSharedKey').filter(({args}) => {
      return bufferAsHex(args.ephemeral_pubkey) === recordPoint().public_key;
    })
    .length,
    replies: callsTo(lnd, 'sendOnionMessage').map(n => n.args.onion.length),
    sent: sent.map((n, i) => {
      // Repeated requests are sent the same invoice as the first one
      const [first] = sent.filter(m => m.id === n.id);

      return {
        id: nameOf(n.id),
        is_repeat: n.is_repeat,
        is_same: first.invoice === n.invoice,
        mtokens: n.mtokens,
        note: noteOf(n, i),
        payer_id: n.payer_id,
      };
    }),
    signatures: callsTo(lnd, 'signMessage').length,
    started,
  };
};

// What a service does when it starts and gets no messages
const idle = {
  errors: [],
  invoice_errors: [],
  invoices: 0,
  is_ended: false,
  menus: [],
  record_keys: 1,
  replies: [],
  sent: [],
  signatures: 1,
  started: [[offer, 0]],
  supporters: [],
};

// What a service does when it ends because of a problem
const ended = message => ({
  ...idle,
  errors: [[400, message]],
  is_ended: true,
  signatures: 0,
  started: [],
});

// The error sent back for a request to pay an amount of zero
const zeroAmount = ['82', 'ExpectedNonZeroAmountInInvoiceRequest', payerKey];

// The fake LND fails to make invoices, which is sent back as an error
const addInvoiceError = [undefined, 'AddInvoiceError', payerKey];

// The first page of the menu, as sent to the payer of menu requests
const firstPage = {offer, page: 0, payer_id: menuPayerKey};

// The error sent back for the menu of an offer with no menu here
const menuUnavailable = ['2000805805', 'SupportMenuUnavailable', menuPayerKey];

// Steps where the service gets a request to pay the offer
const requested = [{received: [makeReceived(request)]}];

// A menu with the related support offer and the offers it lists
const nested = [{offer: episode, related: [{offer: guest}, {offer: tip}]}];

// Change a request for the expiring offer to be for the offer that expired,
// like a request that was made before the offer expired
const asExpired = encoded => createSignedInvoiceRequest({
  encoded: encodeTlvStream({
    records: decodeTlvStream({encoded}).records
      .filter(n => n.type !== '240')
      .map(n => n.type === '14' ? {type: '14', value: '67748580'} : n)
      .map(({type, value}) => ({type, value})),
  })
  .encoded,
  secret: Buffer.alloc(32, 2).toString('hex'),
})
.encoded;

// Change the last byte of the signature of a request so it is not valid
const withBadSignature = encoded => encodeTlvStream({
  records: decodeTlvStream({encoded}).records.map(({type, value}) => {
    // Exit early when the record is not the signature
    if (type !== '240') {
      return {type, value};
    }

    const last = value.endsWith('00') ? '01' : '00';

    return {type, value: value.slice(0, -2) + last};
  }),
})
.encoded;

// Make a menu request with a signature that is not valid, not replied to
const badMenuRequest = () => withBadSignature(makeMenuRequest());

// Make a menu request for another offer, which is not replied to
const otherMenuRequest = () => makeMenuRequest({
  to: makeOffer({description: 'other', id: '0c'.repeat(16)}),
});

// The id of an invoice made by the fake LND, by the order it was made in
// Invoices are named by the order that the node made them in
const invoiceId = n => `invoice ${n}`;

// An invoice sent to the payer of the request to pay the offer
const sentInvoice = {
  id: invoiceId(1),
  is_repeat: false,
  is_same: true,
  mtokens: '1000',
  note: undefined,
  payer_id: asKey(2),
};

// Make support offers of the issuer for levels of related menus
const level = () => [1, 2, 3, 4, 5].map(n => makeOffer({
  description: `level ${n}`,
  id: Buffer.alloc(16, n + 16).toString('hex'),
}));

// Nest offers so that the menu of each lists the one before it
const nest = offers => offers.reduce((related, offer) => {
  return [{offer, related}];
},
[]);

// Make a support offer of another issuer
const otherSupport = () => makeOffer({
  description: 'other',
  id: '0e'.repeat(16),
  issuer_id: asKey(6),
});

/** Serve the support offer with a fake LND and summarize what it did, with
  the messages and results that the support offer service tests share

  `serve` takes the arguments of the service and of the harness, and the
  service finishes the work of each step before the next step.

  @returns
  {
    addInvoiceError: <Invoice Error Sent When an Invoice Fails Array>
    asExpired: <Make a Request for the Offer That Expired Function>
    asKey: <Get the Public Key of a Secret of a Number Function>
    badMenuRequest: <Make a Menu Request With a Bad Signature Function>
    ended: <Result of a Service That Ended Because of a Problem Function>
    firstPage: <First Page of the Menu as Sent Object>
    idle: <Result of a Service That Gets No Messages Object>
    invoiceId: <Name of an Invoice by the Order It Was Made In Function>
    level: <Make Support Offers for Levels of Related Menus Function>
    makeAmountlessRequest: <Make a Request Without an Amount Function>
    makeMenuRequest: <Make a Request for a Page of a Menu Function>
    makeReceived: <Make an Onion Message With a Request Function>
    makeReceivedOver: <Make an Onion Message With Reply Hops Function>
    makeRecord: <Make a Support Service Record Function>
    menuUnavailable: <Invoice Error Sent for a Menu That Is Not Here Array>
    nest: <Nest Offers So Each Menu Lists the One Before It Function>
    nested: <Related Support Offer With a Menu of Offers Array>
    otherMenuRequest: <Make a Menu Request for Another Offer Function>
    otherSupport: <Make a Support Offer of Another Issuer Function>
    payerNote: <Payer Note Record of a Number of Bytes Function>
    payerOffer: <Payer Offer Record of a Number of Bytes Function>
    requested: <Steps Where the Service Gets a Request to Pay Array>
    sentInvoice: <Invoice Sent for the Request to Pay Object>
    serve: <Serve the Offer and Summarize What It Did Function>
    zeroAmount: <Invoice Error Sent for an Amount of Zero Array>
  }
*/
module.exports = {
  addInvoiceError,
  asExpired,
  asKey,
  badMenuRequest,
  ended,
  firstPage,
  idle,
  invoiceId,
  level,
  makeAmountlessRequest,
  makeMenuRequest,
  makeReceived,
  makeReceivedOver,
  makeRecord,
  menuUnavailable,
  nest,
  nested,
  otherMenuRequest,
  otherSupport,
  payerNote,
  payerOffer,
  requested,
  sentInvoice,
  serve,
  zeroAmount,
};
