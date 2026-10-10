const {deepStrictEqual, equal} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {getInvoice} = require('ln-service');
const {parseInvoice} = require('invoices');
const {parseInvoiceError} = require('invoices');
const {parseOffer} = require('invoices');
const {pay} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');
const {sendMessage} = require('ln-service');
const {setupChannel} = require('ln-docker-daemons');
const {spawnLightningCluster} = require('ln-docker-daemons');
const {subscribeToMessages} = require('ln-service');

const {createSupportOffer} = require('./../../');
const {getSupportMenu} = require('./../../support');
const {openSupportNote} = require('./../../support');
const menuIdForPages = require('./../../support/menu_id_for_pages');
const {serviceSupportOffer} = require('./../../');
const {signPayerOffer} = require('./../../support');

const interval = 100;
const isInvoiceReply = type => [typeInvoice, typeInvoiceError].includes(type);
const isNotReady = n => !!n.error && n.error[1] === notReadyError;
const mtokens = '100000';
const notReadyError = 'FailedToCreateInvoiceForSupporter';
const pathHops = '--routing.blinding.num-hops=0';
const payerSecret = Buffer.alloc(32, 2);
const realHops = '--routing.blinding.min-num-real-hops=0';
const blindedPathAtSelf = [realHops, pathHops];
const size = 2;
const timeout = 1000 * 3;
const times = 100;
const typeInvoice = '66';
const typeInvoiceError = '68';
const typeInvoiceRequest = '64';
const waitInterval = 1000;
const waitTimes = 60;

const payerId = Buffer.from(pointFromScalar(payerSecret)).toString('hex');

// Send an invoice request for an offer and wait for the invoice reply
const requestInvoice = ({from, lnd, offer, records}) => {
  return new Promise((resolve, reject) => {
    const [path] = parseOffer({offer}).paths;
    const sub = subscribeToMessages({lnd});

    const unsigned = createUnsignedInvoiceRequest({
      mtokens,
      offer,
      network: 'regtest',
      payer_id: payerId,
    });

    // Records like a payer offer are added before the request is signed
    const withRecords = encodeTlvStream({
      records: decodeTlvStream({encoded: unsigned.encoded}).records
        .map(({type, value}) => ({type, value}))
        .concat(records || []),
    });

    const {encoded} = createSignedInvoiceRequest({
      encoded: withRecords.encoded,
      secret: payerSecret.toString('hex'),
    });

    const timer = setTimeout(() => {
      sub.removeAllListeners();

      return reject([0, 'InvoiceRequestTimeout']);
    },
    timeout);

    sub.on('error', err => reject(err));

    sub.on('message_received', ({message}) => {
      if (!message || !isInvoiceReply(message.type)) {
        return;
      }

      clearTimeout(timer);

      sub.removeAllListeners();

      // An invoice error means the recipient could not make an invoice
      if (message.type === typeInvoiceError) {
        const {message: error} = parseInvoiceError({encoded: message.value});

        return reject([503, 'GotInvoiceErrorForInvoiceRequest', {error}]);
      }

      return resolve(parseInvoice({encoded: message.value}));
    });

    return sendMessage({
      lnd,
      inbound: path.hops,
      key: path.key,
      message: {type: typeInvoiceRequest, value: encoded},
      outbound: [path.introduction_node],
      reply: [from],
    },
    err => {
      if (!!err) {
        clearTimeout(timer);

        sub.removeAllListeners();

        return reject(err);
      }

      return;
    });
  });
};

// Servicing a support offer should return invoices that can be paid
test(`Service support offer`, async () => {
  // Invoices start their blinded paths at the server itself, so that LND
  // does not need the channel in its graph to make the paths
  const {kill, nodes} = await spawnLightningCluster({
    size,
    lnd_configuration: blindedPathAtSelf,
  });

  const [server, client] = nodes;

  try {
    // The client has a channel to the server to pay invoices over
    await setupChannel({
      generate: client.generate,
      lnd: client.lnd,
      to: server,
    });

    const created = await createSupportOffer({
      description: 'support',
      lnd: server.lnd,
      suggested_mtokens: ['1000000'],
    });

    // A separate support offer from the same issuer on the menu
    const art = await createSupportOffer({
      description: 'support my art',
      issuer_record: created.record,
      lnd: server.lnd,
      suggested_mtokens: ['2100000'],
    });

    // A support offer for one piece of art, on the menu of the art offer
    const piece = await createSupportOffer({
      description: 'support one piece',
      issuer_record: created.record,
      lnd: server.lnd,
    });

    const payments = [];
    const sent = [];

    const service = serviceSupportOffer({
      lnd: server.lnd,
      record: created.record,
      related: [{offer: art.offer, related: [{offer: piece.offer}]}],
      support_note: 'Thank you!',
    });

    // Problems servicing requests are collected to fail the test with them
    const problems = [];

    service.error(err => problems.push({error: err}));
    service.supporter(payment => payments.push(payment));
    service.invoice(invoice => sent.push(invoice));

    // The supporter has a support offer of its own to send with the payment
    const supporter = await createSupportOffer({
      description: 'support me back',
      lnd: client.lnd,
    });

    const payerOffer = await signPayerOffer({
      lnd: client.lnd,
      payer_id: payerId,
      record: supporter.record,
    });

    // Retry and mine blocks while invoices cannot be made yet, but stop when
    // the service reports any other problem with the request
    const invoice = await asyncRetry({
      errorFilter: () => problems.every(isNotReady),
      interval: waitInterval,
      times: waitTimes,
    },
    cbk => {
      return client.generate({})
        .then(() => requestInvoice({
          from: client.id,
          lnd: client.lnd,
          offer: created.offer,
          records: [{type: payerOffer.type, value: payerOffer.value}],
        }))
        .then(res => cbk(null, res), err => cbk(err));
    })
    .catch(err => {
      const other = problems.filter(n => !isNotReady(n));

      deepStrictEqual({err, other}, {err, other: []}, 'No other problems');

      throw err;
    });

    const {issuer_id} = parseOffer({offer: created.offer});

    equal(invoice.node_id, issuer_id, 'Invoice signed by offer issuer');
    equal(issuer_id !== server.id, true, 'Offer issuer is not node key');
    equal(invoice.mtokens, mtokens, 'Invoice is for the requested amount');
    equal(invoice.payer_id, payerId, 'Invoice is for the payer');

    // The LND invoice has the same blinded paths as the BOLT 12 invoice
    const lndInvoice = await getInvoice({id: invoice.id, lnd: server.lnd});

    const paidWith = await pay({lnd: client.lnd, request: lndInvoice.request});

    // The note in the invoice can be read with the preimage of the payment
    deepStrictEqual(
      openSupportNote({invoice: invoice.invoice, preimage: paidWith.secret}),
      {note: 'Thank you!'},
      'Got the support note after paying'
    );

    const paid = await getInvoice({id: invoice.id, lnd: server.lnd});

    equal(paid.is_confirmed, true, 'Invoice was paid over blinded paths');

    // The supporter is reported when the invoice is paid
    await asyncRetry({interval, times}, async () => {
      if (!payments.length) {
        throw new Error('ExpectedSupporterPayment');
      }
    });

    const [payment] = payments;

    // The invoice sent back to the supporter was reported
    const [invoiceSent] = sent;

    equal(invoiceSent.id, invoice.id, 'Sent invoice has payment hash');
    equal(invoiceSent.invoice.startsWith('lni1'), true, 'Got invoice string');
    equal(invoiceSent.is_repeat, false, 'Invoice was sent once');
    equal(invoiceSent.payer_id, payerId, 'Sent invoice has payer id');
    equal(invoiceSent.payer_offer, supporter.offer, 'Invoice has payer offer');
    equal(invoiceSent.offer, created.offer, 'Sent invoice is for the offer');

    equal(payment.id, invoice.id, 'Payment has payment hash');
    // Blinded paths can end in hops the recipient adds, whose fees it keeps,
    // so the amount received can be more than the invoice amount
    equal(payment.mtokens, paid.received_mtokens, 'Payment has amount');
    equal(BigInt(payment.mtokens) >= BigInt(mtokens), true, 'Got the amount');
    equal(payment.payer_id, payerId, 'Payment has supporter payer id');
    equal(payment.payer_offer, supporter.offer, 'Payment has payer offer');
    equal(payment.offer, created.offer, 'Payment is for the offer');

    // A supporter's wallet can see the menu before paying
    const menu = await getSupportMenu({
      lnd: client.lnd,
      offer: created.offer,
    });

    // The signed page expires in a day
    const expiresIn = Date.parse(menu.expires_at) - Date.now();

    equal(expiresIn > 0 && expiresIn <= 86400000, true, 'Menu expires');

    // The art offer is listed without its paths, and has the offer paths
    const [listed] = menu.offers;

    deepStrictEqual(
      parseOffer({offer: listed.offer}).paths,
      parseOffer({offer: created.offer}).paths,
      'The art offer is reached over the paths of the support offer'
    );

    deepStrictEqual(
      menu,
      {
        expires_at: menu.expires_at,
        menu_id: menuIdForPages({
          pages: [[{offer: art.offer, is_without_paths: true}]],
        })
        .menu_id,
        offers: [{
          amount: undefined,
          currency: undefined,
          description: 'support my art',
          expires_at: undefined,
          is_same_issuer: true,
          is_support_offer: true,
          issuer: undefined,
          issuer_id,
          mtokens: undefined,
          offer: listed.offer,
          service: {id: art.service_id, type: '1', version: 1},
          suggested_amounts: undefined,
          suggested_currency: undefined,
          suggested_mtokens: ['2100000'],
        }],
        page: 0,
        pages: 1,
        suggested_amounts: undefined,
        suggested_currency: undefined,
        suggested_mtokens: ['1000000'],
      },
      'Got the menu'
    );

    // Asking again with the menu id gets the same menu
    const again = await getSupportMenu({
      lnd: client.lnd,
      menu_id: menu.menu_id,
      offer: created.offer,
    });

    equal(again.menu_id, menu.menu_id, 'Got the same menu');

    // The art offer on the menu has a menu of its own
    const artMenu = await getSupportMenu({
      lnd: client.lnd,
      offer: listed.offer,
    });

    const [listedPiece] = artMenu.offers;

    equal(listedPiece.description, 'support one piece', 'Got the art menu');
    equal(listedPiece.is_same_issuer, true, 'The piece pays the same issuer');
    equal(listedPiece.service.id, piece.service_id, 'Listed piece offer');

    service.stop({});
  } finally {
    await kill({});
  }
});
