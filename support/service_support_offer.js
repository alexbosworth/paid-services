const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {getPublicKey} = require('ln-service');
const {parseOffer} = require('invoices');
const {subscribeToInvoices} = require('ln-service');

const decodeSupportRecord = require('./decode_support_record');
const {defaultMaxRequestsPerHour} = require('./constants');
const {defaultMaxUnpaidInvoicesPerHour} = require('./constants');
const {derivedKeyFamily} = require('./constants');
const encodeMenuEntry = require('./encode_menu_entry');
const {getRecordKey} = require('./../service_records');
const invoiceForRequest = require('./invoice_for_request');
const invoicePathsToFit = require('./invoice_paths_to_fit');
const isSupportOffer = require('./is_support_offer');
const lengthWithoutRecord = require('./length_without_record');
const {maxInvoiceRequestBytes} = require('./constants');
const {maxKeyIndex} = require('./constants');
const {maxReplyHops} = require('./constants');
const {maxSupportNoteBytes} = require('./constants');
const {menuResignMs} = require('./constants');
const {menuSignatureMs} = require('./constants');
const offerBitcoinNetwork = require('./offer_bitcoin_network');
const offerForRequest = require('./offer_for_request');
const payerOfferForRequest = require('./payer_offer_for_request');
const {readRecordKeyIndex} = require('./../service_records');
const relatedMenuLevels = require('./related_menu_levels');
const relatedMenus = require('./related_menus');
const replyInvoiceError = require('./reply_invoice_error');
const requestKey = require('./request_key');
const {requestsWindowMs} = require('./constants');
const sealSupportNote = require('./seal_support_note');
const {serviceNetworkMessages} = require('./../network');
const sharedResult = require('./shared_result');
const signInvoiceForRequest = require('./sign_invoice_for_request');
const signSupportMenus = require('./sign_support_menus');
const {typeInvoice} = require('./constants');
const {typeInvoiceError} = require('./constants');
const {typeInvoiceRequest} = require('./constants');
const {typeInvoiceSupportNote} = require('./constants');
const {typeMenuRequest} = require('./constants');
const {typePayerOffer} = require('./constants');
const unpaidInvoices = require('./unpaid_invoices');
const {unpaidWindowMs} = require('./constants');

const {isArray} = Array;
const {isSafeInteger} = Number;
const asMs = date => new Date(date).getTime();
const byteLength = hex => hex.length / 2;
const errorMessage = err => (isArray(err) && err[1]) || failedToCreate;
const failedToCreate = 'FailedToCreateInvoice';
const isAccepted = (indexes, index) => !indexes || indexes.includes(index);
const isAmount = mtokens => isText(mtokens) && /^[1-9][0-9]*$/.test(mtokens);
const isExpired = offer => parseOffer({offer}).is_expired;
const isIndex = index => isSafeInteger(index) && index >= 0;
const isKeyIndex = index => isIndex(index) && index <= maxKeyIndex;
const isKeyIndexes = indexes => !indexes || indexes.every(isKeyIndex);
const isNote = note => isText(note) && noteBytes(note) <= maxSupportNoteBytes;
const isText = text => typeof text === 'string' && !!text;
const isTooLarge = err => isArray(err) && err[0] === 413;
const lengthSignatureRecord = 66;
const noteBytes = note => Buffer.byteLength(note, 'utf8');
const now = () => Date.now();
const payerOfferTooLarge = 'PayerOfferTooLarge';
const requestTooLarge = 'InvoiceRequestTooLarge';
const signatureExpiry = () => new Date(now() + menuSignatureMs);
const tooLarge = isOffer => isOffer ? payerOfferTooLarge : requestTooLarge;
const typeRequestAmount = '82';

/** Service payments from supporters to a support offer

  The offer and its `record` are from `createSupportOffer`. Before requests
  are serviced, the record is checked to be made by this node, its offer is
  checked to be a support offer of a supported version, and its signing key
  is checked to be the offer issuer id. When a check fails, or the related
  offers cannot be made into menus, an error is emitted and the service ends.

  Requests that did not arrive on an offer path are ignored. Invalid requests
  on an offer path are sent an invoice error. A request that is sent again is
  sent the same invoice. Invoices expire after an hour, and no more than
  `max_unpaid_invoices_per_hour` invoices made in the last hour can be
  unpaid. No more than `max_requests_per_hour` requests to pay, and as many
  menu requests, are answered in an hour. Requests over a limit are ignored.

  Give the `record_key_indexes` that records are accepted with, so that no
  key is derived for any other index.

  The `related` offers make up the menu, in the order they are given. An
  offer with the issuer id of the support offer, and without an amount,
  currency, or quantity, is listed without its paths, and requests to pay it
  are answered here. When it is a support offer, it can have `related`
  offers of its own, as a menu nested up to 4 levels deep. Other offers are
  listed whole. A reference lists an offer at a BIP 353 name. Related offers
  have to be payable on the network of the support offer, and each has to
  fit on a menu page. Pages are signed by the offer issuer id key, expire
  after a day, and are signed again before they expire. Menu requests with
  reply paths of more than 8 hops are ignored.

  A reply is never sent in a larger onion message than its request: an
  invoice that does not fit is sent with fewer payment paths, or as an
  invoice error with a reply too large record, which names the payer offer
  record when the invoice would fit without it.

  A valid signed payer offer in a request is given as `payer_offer`, or as
  `payer_offer_reference`: look up the offer at the name and check it with
  `verifyOfferReference` before using it. A payer offer is never paid here.

  A `support_note` of at most 128 bytes of UTF-8 text is put in each
  invoice, sealed to the payment preimage, unless the invoice would not fit
  with it.

  Set LND `gc-canceled-invoices-on-the-fly` to delete expired invoices.

  A listener that throws does not stop the service. Stopping the service
  stops the handling of requests that are being handled, so nothing more is
  sent.

  {
    lnd: <Authenticated LND API Object>
    record: <Support Service Record Hex String>
    [record_key_indexes]: [<Accepted Record Key Index Number>]
    [support_note]: <Note To Supporters, Like a Thank You, String>
    [related]: [{
      [bip353_name]: <Related Offer BIP 353 Human Readable Name String>
      [issuer_id]: <Related Offer Issuer Id Public Key Hex String>
      [offer]: <Related BOLT 12 Offer String>
      [related]: [<Related Offer of the Related Support Offer Object>]
      [service_id]: <Related Support Offer Service Id Hex String>
      [service_sequence]: <Related Support Offer Lowest Sequence String>
    }]
  }

  @throws
  <Error>

  @returns
  {
    end: <Add a Service Ended Function>
    error: <Add an Error Listener Function>
    invoice: <Add an Invoice Sent Listener Function>
    invoice_error: <Add an Invoice Error Sent Listener Function>
    menu: <Add a Menu Sent Listener Function>
    stop: <Stop Listening Function> ({}) => {};
    supporter: <Add a Supporter Paid Listener Function>
  }

    supporter:
    @returns via cbk
    {
      id: <Payment Hash Hex String>
      mtokens: <Received Millitokens String>
      offer: <Paid BOLT 12 Offer String>
      [payer_note]: <Supporter Note String>
      [payer_offer]: <Supporter Signed BOLT 12 Offer String>
      [payer_offer_reference]: {
        bip353_name: <Payer Offer BIP 353 Human Readable Name String>
        issuer_id: <Payer Offer Issuer Id Public Key Hex String>
        network: <Paid Support Offer Bitcoin Network Name String>
        [service_id]: <Payer Support Offer Service Id Hex String>
        [service_sequence]: <Lowest Support Offer Service Sequence String>
      }
      payer_id: <Supporter Payer Public Key Hex String>
    }

    invoice:
    @returns via cbk
    {
      expires_at: <Invoice Expires At ISO 8601 Date String>
      id: <Payment Hash Hex String>
      invoice: <BOLT 12 Invoice String>
      is_repeat: <Invoice Was Sent Again For a Repeated Request Bool>
      mtokens: <Invoice Amount Millitokens String>
      offer: <Paid BOLT 12 Offer String>
      [payer_note]: <Supporter Note String>
      [payer_offer]: <Supporter Signed BOLT 12 Offer String>
      [payer_offer_reference]: {
        bip353_name: <Payer Offer BIP 353 Human Readable Name String>
        issuer_id: <Payer Offer Issuer Id Public Key Hex String>
        network: <Paid Support Offer Bitcoin Network Name String>
        [service_id]: <Payer Support Offer Service Id Hex String>
        [service_sequence]: <Lowest Support Offer Service Sequence String>
      }
      payer_id: <Supporter Payer Public Key Hex String>
    }

    invoice_error:
    @returns via cbk
    {
      [erroneous_field]: <Erroneous Request Record Type Number String>
      message: <Error Message String>
      [payer_id]: <Supporter Payer Public Key Hex String>
    }

    menu:
    @returns via cbk
    {
      offer: <BOLT 12 Support Offer of the Menu String>
      page: <Menu Page Number Number>
      payer_id: <Supporter Payer Public Key Hex String>
    }
*/
module.exports = args => {
  if (!args.lnd) {
    throw new Error('ExpectedLndToServiceSupportOffer');
  }

  if (!args.record || typeof args.record !== 'string') {
    throw new Error('ExpectedSupportRecordToServiceSupportOffer');
  }

  if (!!args.record_key_indexes && !isArray(args.record_key_indexes)) {
    throw new Error('ExpectedArrayOfRecordKeyIndexesToServiceSupportOffer');
  }

  if (!isKeyIndexes(args.record_key_indexes)) {
    throw new Error('ExpectedRecordKeyIndexesToServiceSupportOffer');
  }

  if (!!args.related && !isArray(args.related)) {
    throw new Error('ExpectedArrayOfRelatedOffersToServiceSupportOffer');
  }

  if (args.support_note !== undefined && !isNote(args.support_note)) {
    throw new Error('ExpectedSupportNoteOfAtMost128BytesToServiceOffer');
  }

  // Related menus are checked to not be too deep as they are when made, so
  // that related offers that cannot be made into menus are not accepted
  if (!relatedMenuLevels({related: args.related}).is_within_max_depth) {
    throw new Error('ExpectedRelatedOffersToServiceSupportOffer');
  }

  // Each related offer is an offer, or a reference to an offer at a name,
  // and can have related offers of its own
  const isEntry = entry => {
    try {
      if (!entry) {
        return false;
      }

      if (!!entry.related && !isArray(entry.related)) {
        return false;
      }

      if (!!entry.related && !entry.related.every(isEntry)) {
        return false;
      }

      return !!encodeMenuEntry(entry).encoded;
    } catch (err) {
      return false;
    }
  };

  if (!!args.related && !args.related.every(isEntry)) {
    throw new Error('ExpectedRelatedOffersToServiceSupportOffer');
  }

  const related = args.related || [];

  const offers = related.map(entry => entry.offer).filter(offer => !!offer);

  const pending = new Map();
  const requests = new Map();
  const service = {
    supporter: () => {},
    end: () => {},
    error: () => {},
    invoice: () => {},
    invoice_error: () => {},
    menu: () => {},
  };
  const waiting = [];

  let answeredCount = 0;
  let answeredMenusCount = 0;
  let isChecked = false;
  let isStopped = false;
  let state;

  const invoicesSub = subscribeToInvoices({lnd: args.lnd});
  const messages = serviceNetworkMessages({lnd: args.lnd});

  // Tell a listener about an event apart from the code that found it, so
  // that a listener that throws cannot stop the service or crash it
  const emit = (event, details) => process.nextTick(() => {
    try {
      return service[event](details);
    } catch (err) {
      // Exit early when the error listener threw, as it cannot be told
      if (event === 'error') {
        return;
      }

      return emit('error', [500, 'UnexpectedErrorInListener', {err, event}]);
    }
  });

  // Call a function, telling the error listener when it throws, so that an
  // unexpected failure handling a request is an error, and is not thrown. A
  // request that was being handled when the service stopped is dropped.
  const guard = fn => (...results) => {
    // Exit early when the service stopped, so that nothing more is sent
    if (isStopped) {
      return;
    }

    try {
      return fn(...results);
    } catch (err) {
      return emit('error', [503, 'FailedToHandleRequest', {err}]);
    }
  };

  // Stop servicing the offer when there is a problem
  const failed = err => {
    // Exit early when the service was already stopped
    if (isStopped) {
      return;
    }

    isStopped = true;

    emit('error', err);

    invoicesSub.removeAllListeners();
    messages.stop({});

    return emit('end');
  };

  // Read the record and check it before servicing requests, starting after
  // the listeners for the service have been added
  process.nextTick(() => asyncAuto({
    // Get the key the record was sealed with
    getRecordKey: cbk => {
      let index;

      try {
        index = readRecordKeyIndex({record: args.record}).index;
      } catch (err) {
        return cbk([400, err.message]);
      }

      // No key is derived for a record key index that is not accepted
      if (!isAccepted(args.record_key_indexes, index)) {
        return cbk([400, 'UnexpectedRecordKeyIndexForSupportRecord']);
      }

      return getRecordKey({index, lnd: args.lnd}, cbk);
    },

    // Check the record was made by this node and read it
    decode: ['getRecordKey', ({getRecordKey}, cbk) => {
      try {
        return cbk(null, decodeSupportRecord({
          key: getRecordKey.key,
          record: args.record,
        }));
      } catch (err) {
        return cbk([400, err.message]);
      }
    }],

    // Get the issuer id of the offer
    issuerId: ['decode', ({decode}, cbk) => {
      let offer;

      try {
        offer = parseOffer({offer: decode.offer});
      } catch (err) {
        return cbk([400, 'ExpectedOfferWithIssuerIdInSupportRecord']);
      }

      if (!offer.issuer_id) {
        return cbk([400, 'ExpectedOfferWithIssuerIdInSupportRecord']);
      }

      // The offer is a support offer of a supported version
      if (!isSupportOffer({offer: decode.offer}).is_support_offer) {
        return cbk([400, 'ExpectedSupportOfferInSupportRecord']);
      }

      return cbk(null, offer.issuer_id);
    }],

    // Check the related offers can be paid on the network of the offer
    checkRelated: ['decode', 'issuerId', ({decode}, cbk) => {
      const {network} = offerBitcoinNetwork({offer: decode.offer});

      const isPayable = offers.every(offer => {
        return parseOffer({offer}).networks.includes(network);
      });

      if (!isPayable) {
        return cbk([400, 'ExpectedRelatedOffersForSupportOfferNetwork']);
      }

      return cbk();
    }],

    // Make the menus, listing offers of the issuer without paths
    menu: [
      'checkRelated',
      'decode',
      'issuerId',
      ({decode, issuerId}, cbk) =>
    {
      try {
        return cbk(null, relatedMenus({
          expires_at: signatureExpiry().toISOString(),
          issuer_id: issuerId,
          offer: decode.offer,
          related: args.related,
        }));
      } catch (err) {
        return cbk([400, err.message]);
      }
    }],

    // Get the signing key of the offer
    getKey: ['decode', ({decode}, cbk) => {
      return getPublicKey({
        family: derivedKeyFamily,
        index: decode.key_index,
        lnd: args.lnd,
      },
      (err, res) => {
        if (!!err) {
          return cbk([503, 'FailedToGetSupportOfferSigningKey', {err}]);
        }

        return cbk(null, res);
      });
    }],

    // Check the signing key is the offer issuer id
    checkKey: ['getKey', 'issuerId', ({getKey, issuerId}, cbk) => {
      if (getKey.public_key !== issuerId) {
        return cbk([400, 'ExpectedKeyIndexForSupportOfferIssuerId']);
      }

      return cbk();
    }],

    // Sign the pages of each menu with the offer issuer id key
    signMenus: ['checkKey', 'decode', 'menu', ({decode, menu}, cbk) => {
      const expiresAt = signatureExpiry().toISOString();

      return asyncMapSeries(menu.menus, (menu, cbk) => {
        return signSupportMenus({
          entries: menu.entries,
          expires_at: expiresAt,
          key_index: decode.key_index,
          lnd: args.lnd,
          offer: menu.offer,
        },
        (err, res) => {
          if (!!err) {
            return cbk([503, 'FailedToSignSupportMenu', {err}]);
          }

          return cbk(null, {
            entries: menu.entries,
            offer: menu.offer,
            signed: {expires_at: expiresAt, pages: res.pages},
          });
        });
      },
      cbk);
    }],

    // Keep what is needed to service requests
    state: [
      'decode',
      'menu',
      'signMenus',
      ({decode, menu, signMenus}, cbk) =>
    {
      const max = decode.max_unpaid_invoices_per_hour;
      const maxRequests = decode.max_requests_per_hour;

      return cbk(null, {
        // Every request to pay that is answered is counted
        answered: unpaidInvoices({
          max: maxRequests || defaultMaxRequestsPerHour,
          ms: requestsWindowMs,
        }),
        // Menu requests that are answered are counted apart
        answered_menus: unpaidInvoices({
          max: maxRequests || defaultMaxRequestsPerHour,
          ms: requestsWindowMs,
        }),
        key_index: decode.key_index,
        // The menus of the offer and of its related support offers, by offer
        menus: new Map(signMenus.map(menu => [menu.offer, menu])),
        offer: decode.offer,
        // Requests for the offer, and for the offers listed without their
        // paths, are answered on the paths of the offer
        offers: [decode.offer]
          .concat(menu.answered.filter(offer => offer !== decode.offer))
          .flatMap(offer => {
            return decode.path_ids.map(id => ({offer, path_id: id}));
          }),
        unpaid: unpaidInvoices({
          max: max || defaultMaxUnpaidInvoicesPerHour,
          ms: unpaidWindowMs,
        }),
      });
    }],
  },
  (err, res) => {
    isChecked = true;

    if (!!err) {
      failed(err);
    } else {
      state = res.state;
    }

    // Requests that arrived while the record was checked are handled now
    return waiting.splice(0).forEach(handle => handle());
  }));

  invoicesSub.on('error', err => failed(err));

  messages.end(() => failed([503, 'NetworkMessagesSubscriptionEnded']));
  messages.error(err => emit('error', err));

  // Supporters have paid when their invoices are paid
  invoicesSub.on('invoice_updated', invoice => {
    const request = requests.get(invoice.id);

    // Exit early when the invoice is not for a supporter or is not paid yet
    if (!request || !invoice.is_confirmed) {
      return;
    }

    requests.delete(invoice.id);

    // The paid invoice no longer counts as unpaid
    state.unpaid.free({key: request.key});
    pending.delete(request.key);

    // The listener is called apart, so a throw does not end the invoices
    return emit('supporter', {
      id: invoice.id,
      mtokens: invoice.received_mtokens,
      offer: request.offer,
      payer_id: request.payer_id,
      payer_note: request.payer_note,
      payer_offer: request.payer_offer,
      payer_offer_reference: request.payer_offer_reference,
    });
  });

  // Sign the pages of a menu again with a new expiry
  const resignMenu = menu => {
    const expiresAt = signatureExpiry().toISOString();

    return signSupportMenus({
      entries: menu.entries,
      expires_at: expiresAt,
      key_index: state.key_index,
      lnd: args.lnd,
      offer: menu.offer,
    },
    (err, res) => {
      const resigned = menu.resigning;

      menu.resigning = null;

      // Exit early when the service stopped while the pages were signed
      if (isStopped) {
        return;
      }

      if (!!err) {
        emit('error', [503, 'FailedToSignSupportMenu', {err}]);

        return resigned.forEach(cbk => cbk(null, null));
      }

      menu.signed = {expires_at: expiresAt, pages: res.pages};

      return resigned.forEach(cbk => cbk(null, res.pages));
    });
  };

  // Get the pages of a menu to reply with, signing them again before they
  // expire. There are no pages when they cannot be signed again in time.
  const pagesForReply = (menu, cbk) => {
    const at = now();
    const expiry = asMs(menu.signed.expires_at);

    // Exit early when the signed pages are not close to expiring
    if (expiry - at > menuResignMs) {
      return cbk(null, menu.signed.pages);
    }

    const isResigning = !!menu.resigning;

    menu.resigning = menu.resigning || [];

    // Pages that have expired are sent once they are signed again
    if (expiry <= at) {
      menu.resigning.push(cbk);
    }

    if (!isResigning) {
      resignMenu(menu);
    }

    // Pages that have not expired yet are used while they are signed again
    if (expiry > at) {
      return cbk(null, menu.signed.pages);
    }
  };

  // Handle an invoice request received for the offer
  const handleRequest = incoming => {
    const {received} = incoming;

    // Exit early when there is no way to send back an invoice
    if (!incoming.reply) {
      return;
    }

    const forRequest = offerForRequest({
      offers: state.offers,
      path_id: received.path_id,
      value: received.value,
    });

    const {error, is_ignored, is_menu, offer, page, request} = forRequest;

    // Exit early when the request was not received on an offer path
    if (!error && !is_menu && !request) {
      return;
    }

    // Exit early when a menu request has a reply path that is too long
    if (!!is_menu && received.reply_hops > maxReplyHops) {
      return;
    }

    // Exit early when too many menu requests have been answered
    if (!!is_menu && !state.answered_menus.take({
      key: String(++answeredMenusCount),
    })) {
      return;
    }

    // Exit early when too many requests to pay have been answered
    if (!is_menu && !state.answered.take({key: String(++answeredCount)})) {
      return;
    }

    // Exit early when the menu request is not replied to
    if (!!is_ignored) {
      return;
    }

    // A reply is never in a larger onion message than its request
    const isRegular = !received.is_large;

    // A request of a size that is not known is answered as a regular one, but
    // the same request in a large onion message would not be answered larger
    const isKnownRegular = received.is_large === false;

    // Send a reply over the reply path of the request
    const send = ({type, value}, cbk) => {
      return incoming.reply({type, value, is_regular: isRegular}, cbk);
    };

    // Send back an invoice error and tell the listener about it once sent
    const sendError = err => {
      // A reply that does not fit a regular request can fit a large one
      const {encoded} = replyInvoiceError({
        erroneous_field: err.erroneous_field,
        is_reply_too_large: !!err.is_too_large && isKnownRegular,
        message: err.message,
      });

      return send({type: typeInvoiceError, value: encoded}, guard(sendErr => {
        if (!!sendErr) {
          return emit('error', [503, 'ErrorSendingInvoiceError', {sendErr}]);
        }

        return emit('invoice_error', {
          erroneous_field: err.erroneous_field,
          message: err.message,
          payer_id: !request ? undefined : request.payer_id,
        });
      }));
    };

    // Exit early and send back an error when the request is not valid
    if (!!error) {
      return sendError(error);
    }

    // Exit early and send back the menu page when the request asks for it
    if (!!is_menu) {
      const menu = state.menus.get(offer.offer);

      // Only the offer and the related offers given menus have them here
      if (!menu) {
        return sendError({
          erroneous_field: typeMenuRequest,
          message: 'SupportMenuUnavailable',
        });
      }

      return pagesForReply(menu, guard((err, pages) => {
        // Exit early when there are no signed pages to send
        if (!pages) {
          return sendError({
            erroneous_field: typeMenuRequest,
            message: 'SupportMenuUnavailable',
          });
        }

        // Exit early when the page does not exist
        if (page >= pages.length) {
          return sendError({
            erroneous_field: typeMenuRequest,
            message: 'UnknownSupportMenuPage',
          });
        }

        const value = pages[page];

        return send({value, type: typeInvoiceError}, guard(err => {
          // A page that does not fit in the size of the request is not sent
          if (isTooLarge(err)) {
            return sendError({
              erroneous_field: typeMenuRequest,
              is_too_large: true,
              message: 'SupportMenuPageTooLarge',
            });
          }

          if (!!err) {
            return emit('error', [503, 'ErrorSendingSupportMenuPage', {err}]);
          }

          return emit('menu', {
            page,
            offer: offer.offer,
            payer_id: request.payer_id,
          });
        }));
      }));
    }

    // Exit early when the offer expired after the request was made
    if (isExpired(request.offer)) {
      return sendError({message: 'OfferExpired'});
    }

    // Exit early when the request does not have an amount to pay
    if (!isAmount(request.mtokens)) {
      return sendError({
        erroneous_field: typeRequestAmount,
        message: 'ExpectedNonZeroAmountInInvoiceRequest',
      });
    }

    // A payer can send an offer it is authorized to present, to be shown
    const payer = payerOfferForRequest({request: received.value});

    // Exit early when the invoice would not fit in a large onion message
    if (byteLength(received.value) > maxInvoiceRequestBytes) {
      const without = lengthWithoutRecord({
        encoded: received.value,
        type: typePayerOffer,
      })
      .bytes;

      // The payer offer is the problem only when it fits without it
      const isPayerOffer = without <= maxInvoiceRequestBytes;

      return sendError({
        erroneous_field: isPayerOffer ? typePayerOffer : undefined,
        message: tooLarge(isPayerOffer),
      });
    }

    // Send back an error when the invoice does not fit in the reply
    const sendTooLarge = fit => {
      // Exit early when the invoice would fit without the payer offer
      if (!!fit.is_payer_offer_too_large) {
        return sendError({
          erroneous_field: typePayerOffer,
          is_too_large: true,
          message: 'PayerOfferTooLarge',
        });
      }

      return sendError({is_too_large: true, message: 'InvoiceTooLarge'});
    };

    // Get the most bytes an invoice can have in a reply to the request
    const getReplyBytes = cbk => {
      // Exit early when the reply can be in a large onion message
      if (!isRegular) {
        return cbk(null, {bytes: Infinity});
      }

      return incoming.reply_bytes({type: typeInvoice}, cbk);
    };

    // Send the signed invoice and tell the listener about it
    const sendInvoice = ({existing, signed}) => {
      return send({type: typeInvoice, value: signed.encoded}, guard(err => {
        if (isTooLarge(err)) {
          return sendTooLarge({});
        }

        if (!!err) {
          return emit('error', [503, 'ErrorSendingInvoice', {err}]);
        }

        return emit('invoice', {
          expires_at: signed.expires_at,
          id: signed.id,
          invoice: signed.invoice,
          is_repeat: !!existing,
          mtokens: signed.mtokens,
          offer: request.offer,
          payer_id: request.payer_id,
          payer_note: request.payer_note,
          payer_offer: payer.payer_offer,
          payer_offer_reference: payer.payer_offer_reference,
        });
      }));
    };

    return getReplyBytes(guard((err, res) => {
      if (!!err) {
        return emit('error', [503, 'FailedToGetReplySizeForInvoice', {err}]);
      }

      const {bytes} = res;

      // An invoice holds the records of its request, other than its signature,
      // so it cannot fit when they do not. Whether it would fit without the
      // payer offer is only known once the invoice is made, so the payer
      // offer is not named here.
      if (byteLength(received.value) - lengthSignatureRecord > bytes) {
        return sendTooLarge({});
      }

      const at = now();

      // Forget requests for invoices that have expired
      pending.forEach((entry, key) => {
        if (!!entry.expires_at && entry.expires_at <= at) {
          pending.delete(key);
          requests.delete(entry.id);
        }
      });

      // A request that is sent again, with the same records other than its
      // signature, is for the same invoice
      const {key} = requestKey({encoded: received.value});

      const existing = pending.get(key);

      // Exit early when there are too many unpaid invoices
      if (!existing && !state.unpaid.take({key, now: at})) {
        return sendError({message: 'TooManyUnpaidInvoices'});
      }

      // Identical requests that arrive while the invoice is made share it
      const entry = existing || {
        invoice: sharedResult({
          start: cbk => invoiceForRequest({request, lnd: args.lnd}, cbk),
        }),
        signed: {},
      };

      // Seal the note for the invoice once, with a salt of its own
      const sealNote = invoice => {
        entry.note = entry.note || sealSupportNote({
          note: args.support_note,
          preimage: invoice.secret,
        });

        return entry.note.encoded;
      };

      // Keep the request of a new invoice until the invoice is paid
      if (!existing) {
        pending.set(key, entry);

        entry.invoice.get(guard((err, res) => {
          if (!!err) {
            pending.delete(key);
            state.unpaid.free({key});

            return emit('error', [
              503,
              'FailedToCreateInvoiceForSupporter',
              {err},
            ]);
          }

          entry.expires_at = asMs(res.expires_at);
          entry.id = res.id;

          return requests.set(res.id, {
            key,
            offer: request.offer,
            payer_id: request.payer_id,
            payer_note: request.payer_note,
            payer_offer: payer.payer_offer,
            payer_offer_reference: payer.payer_offer_reference,
          });
        }));
      }

      return entry.invoice.get(guard((err, invoice) => {
        if (!!err) {
          return sendError({message: errorMessage(err)});
        }

        // A note is sealed to the payment preimage and a salt, and is the
        // same note each time that this invoice is sent
        const noteRecord = () => ({
          type: typeInvoiceSupportNote,
          value: sealNote(invoice),
        });

        const note = !args.support_note ? [] : [noteRecord()];

        const fitFor = records => invoicePathsToFit({
          bytes,
          invoice,
          records,
          request,
          paths: invoice.paths,
        });

        const withNote = fitFor(note);

        // The note is left out when the invoice would not fit with it
        const hasRoom = !!withNote.count || !note.length;
        const withoutNote = () => ({...fitFor([]), records: []});

        const fit = hasRoom ? {...withNote, records: note} : withoutNote();

        // Exit early when the invoice does not fit with one payment path
        if (!fit.count) {
          return sendTooLarge(fit);
        }

        const signedKey = [fit.count, fit.records.length].join(':');

        // An invoice is signed once for each number of paths and records
        const signing = entry.signed[signedKey] || sharedResult({
          start: cbk => signInvoiceForRequest({
            invoice,
            request,
            key_index: state.key_index,
            lnd: args.lnd,
            paths: invoice.paths.slice(Number(), fit.count),
            records: fit.records,
          },
          cbk),
        });

        entry.signed[signedKey] = signing;

        return signing.get(guard((err, signed) => {
          if (!!err) {
            // A signature that failed can be tried again
            if (entry.signed[signedKey] === signing) {
              delete entry.signed[signedKey];
            }

            emit('error', [503, 'FailedToSignInvoiceForSupporter', {err}]);

            return sendError({message: errorMessage(err)});
          }

          return sendInvoice({existing, signed});
        }));
      }));
    }));
  };

  // Requests are only serviced once the record has been checked
  messages.message({type: typeInvoiceRequest}, (received, res) => {
    const handle = guard(() => {
      // Exit early when the record did not pass its checks
      if (!state) {
        return;
      }

      return handleRequest({
        received,
        reply: res.reply,
        reply_bytes: res.reply_bytes,
      });
    });

    // Exit early when the record is still being checked
    if (!isChecked) {
      return waiting.push(handle);
    }

    return handle();
  });

  return {
    end: cbk => service.end = cbk,
    error: cbk => service.error = cbk,
    invoice: cbk => service.invoice = cbk,
    invoice_error: cbk => service.invoice_error = cbk,
    menu: cbk => service.menu = cbk,
    stop: ({}) => {
      isStopped = true;

      invoicesSub.removeAllListeners();

      return messages.stop({});
    },
    supporter: cbk => service.supporter = cbk,
  };
};
