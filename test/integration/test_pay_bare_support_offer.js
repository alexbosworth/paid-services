const {createHash} = require('node:crypto');
const {deepStrictEqual, equal} = require('node:assert').strict;
const test = require('node:test');

const asyncRetry = require('async/retry');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {getInvoice} = require('ln-service');
const {parseInvoice} = require('invoices');
const {parseInvoiceError} = require('invoices');
const {parseOffer} = require('invoices');
const {payViaRoutes} = require('ln-service');
const {pointFromScalar} = require('tiny-secp256k1');
const {probeForRoute} = require('ln-service');
const {spawnLightningCluster} = require('ln-docker-daemons');

const {createSupportOffer} = require('./../../');
const {getOfferInvoice} = require('./../../offers');
const {payOffer} = require('./../../offers');
const {payOfferInvoice} = require('./../../offers');
const {requestNetworkReply} = require('./../../network');
const {serviceSupportOffer} = require('./../../');

const bufferAsHex = buffer => buffer.toString('hex');
const capacity = 1e6;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const interval = 1000;
const keyOf = secret => bufferAsHex(Buffer.from(pointFromScalar(secret)));
const maxFeeMtokens = '100000';
const mtokens = '250000';
const payerSecret = Buffer.alloc(32, 3);
const sha256 = n => createHash('sha256').update(n).digest('hex');
const size = 3;
const timeout = 1000 * 10;
const times = 60;
const typeInvoice = '66';
const typeInvoiceError = '68';
const typeInvoiceRequest = '64';
const typeSupportNote = '3000805805';

const payerId = keyOf(payerSecret);

// A support offer is paid by a payer that only knows BOLT 12: it sends an
// invoice request for the offer, checks the invoice, and pays it over the
// blinded payment paths in the invoice
test(`Pay a bare support offer as a BOLT 12 offer`, async () => {
  // Each node opens a confirmed channel to the next, so the payer reaches
  // the recipient through the relay: client -> relay -> server
  const {kill, nodes} = await spawnLightningCluster({capacity, size});

  const [client, relay, server] = nodes;

  // The service is stopped when the test ends, even when the test fails
  const services = [];

  try {
    // The most minimal support offer, with no description or other options
    const created = await createSupportOffer({lnd: server.lnd});

    const service = serviceSupportOffer({
      lnd: server.lnd,
      record: created.record,
    });

    services.push(service);

    const errors = [];
    const payments = [];

    service.error(err => errors.push(err));
    service.supporter(payment => payments.push(payment));

    // To the payer, the offer is a BOLT 12 offer without an amount
    const offer = parseOffer({offer: created.offer});

    equal(offer.mtokens, undefined, 'The offer has no amount');
    equal(offer.description, undefined, 'The offer has no description');
    equal(!!offer.issuer_id, true, 'The offer has an issuer id');
    equal(offer.paths.length, 1, 'The offer has one path');

    // The payer chooses an amount and signs an invoice request for it
    const request = createSignedInvoiceRequest({
      encoded: createUnsignedInvoiceRequest({
        mtokens,
        network: 'regtest',
        offer: created.offer,
        payer_id: payerId,
      })
      .encoded,
      secret: bufferAsHex(payerSecret),
    });

    // Retry until the channels are known and the invoice can have paths
    const invoice = await asyncRetry({interval, times}, async () => {
      await client.generate({});

      const {reply} = await requestNetworkReply({
        timeout,
        introduction: relay.id,
        lnd: client.lnd,
        message: {type: typeInvoiceRequest, value: request.encoded},
        path: offer.paths[0],
        types: [typeInvoice, typeInvoiceError],
      });

      if (reply.type === typeInvoiceError) {
        const {message} = parseInvoiceError({encoded: reply.value});

        throw new Error(`ExpectedInvoiceForRequest: ${message}`);
      }

      // The invoice is checked as BOLT 12 requires, against the request sent
      return parseInvoice({encoded: reply.value, request: request.request});
    });

    equal(invoice.node_id, offer.issuer_id, 'Invoice signed by offer issuer');
    equal(invoice.mtokens, mtokens, 'Invoice is for the chosen amount');
    equal(invoice.payer_id, payerId, 'Invoice is for the payer');
    equal(invoice.is_expired, false, 'Invoice has not expired');
    equal(!!invoice.paths.length, true, 'Invoice has blinded payment paths');

    // Without a note, the invoice has no records beyond BOLT 12 records
    const records = decodeTlvStream({encoded: invoice.encoded}).records;

    equal(!!records.find(n => n.type === typeSupportNote), false, 'No note');

    // The payer finds a route into the blinded paths of the invoice
    const {route} = await asyncRetry({interval, times}, async () => {
      await client.generate({});

      const probe = await probeForRoute({
        mtokens,
        lnd: client.lnd,
        paths: invoice.paths,
        tokens: Number(BigInt(mtokens) / BigInt(1e3)),
      });

      if (!probe.route) {
        throw new Error('ExpectedRouteIntoInvoicePaths');
      }

      return probe;
    });

    const paid = await payViaRoutes({
      id: invoice.id,
      lnd: client.lnd,
      routes: [route],
    });

    equal(sha256(Buffer.from(paid.secret, 'hex')), invoice.id, 'Got preimage');

    const received = await getInvoice({id: invoice.id, lnd: server.lnd});

    equal(received.is_confirmed, true, 'The recipient received the payment');

    // The recipient is told about the supporter
    await asyncRetry({interval: 100, times: 100}, async () => {
      await client.generate({});

      if (!payments.length) {
        throw new Error('ExpectedSupporterPayment');
      }
    });

    const [payment] = payments;

    deepStrictEqual(
      {id: payment.id, offer: payment.offer, payer_id: payment.payer_id},
      {id: invoice.id, offer: created.offer, payer_id: payerId},
      'Got the supporter payment'
    );

    // The recipient can receive more than the invoice amount: the payer pays
    // the fees of the whole blinded path, including fees of hops that the
    // recipient adds to the end of the path, which the recipient keeps
    equal(payment.mtokens, received.received_mtokens, 'Got received amount');

    const got = BigInt(payment.mtokens);

    equal(got >= BigInt(mtokens), true, 'Received at least invoice amount');
    equal(got <= BigInt(route.mtokens), true, 'Received at most amount sent');

    // Wait for a number of supporter payments to be reported
    const waitForPayments = async count => {
      await asyncRetry({interval: 100, times: 100}, async () => {
        await client.generate({});

        if (payments.length < count) {
          throw new Error('ExpectedSupporterPayment');
        }
      });
    };

    // A payer can get the invoice, show it, and then pay it
    const offerInvoice = await getOfferInvoice({
      mtokens,
      lnd: client.lnd,
      offer: created.offer,
    });

    equal(offerInvoice.mtokens, mtokens, 'Got an invoice for the amount');
    equal(offerInvoice.payer_id === payerId, false, 'With a new payer id');
    equal(
      keyOf(hexAsBuffer(offerInvoice.payer_secret)),
      offerInvoice.payer_id,
      'With the secret of the payer id'
    );
    equal(Date.parse(offerInvoice.expires_at) > Date.now(), true, 'Unexpired');

    const paidInvoice = await payOfferInvoice({
      invoice: offerInvoice.invoice,
      lnd: client.lnd,
      max_fee_mtokens: maxFeeMtokens,
    });

    equal(paidInvoice.id, offerInvoice.id, 'Paid the invoice');

    equal(
      sha256(Buffer.from(paidInvoice.secret, 'hex')),
      offerInvoice.id,
      'Got the preimage of the invoice'
    );

    await waitForPayments(2);

    equal(payments[1].id, offerInvoice.id, 'Got the second payment');
    equal(payments[1].payer_id, offerInvoice.payer_id, 'Got the payer id');

    // Or the payer can do both in one call
    const paidOffer = await payOffer({
      mtokens,
      lnd: client.lnd,
      max_fee_mtokens: maxFeeMtokens,
      offer: created.offer,
    });

    equal(
      sha256(Buffer.from(paidOffer.secret, 'hex')),
      paidOffer.id,
      'Paid the offer'
    );

    equal(paidOffer.mtokens, mtokens, 'Paid an invoice for the chosen amount');

    const again = await getInvoice({id: paidOffer.id, lnd: server.lnd});

    equal(again.is_confirmed, true, 'The recipient received the payment');

    await waitForPayments(3);

    equal(payments[2].id, paidOffer.id, 'Got the third payment');
    equal(payments[2].payer_id, paidOffer.payer_id, 'Got the third payer id');

    equal(
      keyOf(hexAsBuffer(paidOffer.payer_secret)),
      paidOffer.payer_id,
      'Got the secret of the third payer id'
    );

    // Invoices cannot be made until the channels are known, which is retried
    const isNotReady = err => err[1] === 'FailedToCreateInvoiceForSupporter';

    deepStrictEqual(errors.filter(n => !isNotReady(n)), [], 'No other errors');
  } finally {
    services.forEach(service => service.stop({}));

    await kill({});
  }
});
