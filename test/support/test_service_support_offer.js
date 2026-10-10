const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const EventEmitter = require('node:events');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {createSignedInvoiceRequest} = require('invoices');
const {createSignedRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {createUnsignedRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../service_records');
const createMenuRequest = require('./../../support/create_menu_request');
const encodeRecord = require('./../../support/encode_support_record');
const keyForSecret = require('./../../service_records/record_key_for_secret');
const method = require('./../../support/service_support_offer');
const recordPoint = require('./../../service_records/record_point');
const supportNoteFor = require('./../../support/support_note_for_invoice');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const pathId = Buffer.alloc(32, 1).toString('hex');
const secret = Buffer.alloc(32, 1);
const sha256 = n => createHash('sha256').update(n).digest();
const wait = () => new Promise(resolve => setTimeout(resolve, 200));

const issuer = asKey(5);
const peer = asKey(7);
const identity = asKey(1);

const path = blindedPathFromHops({hops: [identity], id: pathId});

const paths = [{hops: path.path, introduction_node: identity, key: path.key}];

// Make an offer of the issuer, labeled for support when it has a label id
const makeOffer = args => {
  const {offer} = createOffer({
    paths,
    description: args.description || 'support',
    expires_at: args.expires_at,
    issuer_id: args.issuer_id || issuer,
    max_quantity: args.max_quantity,
    networks: args.networks || ['regtest'],
  });

  // Exit early when the offer is not labeled
  if (!args.id) {
    return offer;
  }

  return addServiceLabel({
    offer,
    id: args.id,
    type: args.type || '1',
    version: args.major || 1,
  })
  .offer;
};

const offer = makeOffer({id: '0d'.repeat(16)});

// RPC uint64 map keys are eight little-endian bytes
const typeAsKey = type => {
  const bytes = Buffer.alloc(8);

  bytes.writeBigUInt64LE(BigInt(type));

  return bytes.toString('latin1');
};

// Make a signed request from a payer to pay an offer, with records added
const makeRequest = ({mtokens, payer, records, to}) => {
  const payerSecret = Buffer.alloc(32, payer || 2);

  const unsigned = createUnsignedInvoiceRequest({
    metadata: '00',
    mtokens: mtokens || '1000',
    network: 'regtest',
    offer: to || offer,
    payer_id: asKey(payer || 2),
  });

  const {encoded} = encodeTlvStream({
    records: decodeTlvStream({encoded: unsigned.encoded}).records
      .map(({type, value}) => ({type, value}))
      .concat(records || []),
  });

  return createSignedInvoiceRequest({
    encoded,
    secret: payerSecret.toString('hex'),
  })
  .encoded;
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

// A payer note record and a payer offer record of a number of bytes
const payerNote = bytes => ({type: '89', value: '61'.repeat(bytes)});

const payerOffer = bytes => ({
  type: '2000805807',
  value: encodeTlvStream({records: [{type: '1', value: '00'.repeat(bytes)}]})
    .encoded,
});

// Make an RPC onion message with a request on the offer path
const makeReceived = (value, replyHops, isLarge) => {
  const hops = Array(replyHops || 1).fill(peer);

  const reply = blindedPathFromHops({hops});

  return {
    custom_records: {[typeAsKey('64')]: hexAsBuffer(value)},
    encrypted_recipient_data: hexAsBuffer(path.path[0].encrypted_data),
    onion: Buffer.alloc(!isLarge ? 1366 : 32834),
    path_key: hexAsBuffer(path.key),
    peer: hexAsBuffer(peer),
    reply_path: {
      blinded_hops: reply.path.map(hop => ({
        blinded_node: hexAsBuffer(hop.relay_key),
        encrypted_data: hexAsBuffer(hop.encrypted_data),
      })),
      blinding_point: hexAsBuffer(reply.key),
      introduction_node: hexAsBuffer(peer),
    },
  };
};

// The blinded payment path of invoices made by the fake LND
const paymentPath = blindedPathFromHops({hops: [peer, identity]});

const paymentPaths = [{
  base_fee_mtokens: '1000',
  cltv_delta: 80,
  features: [],
  fee_rate: 1,
  hops: paymentPath.path,
  introduction_node: peer,
  key: paymentPath.key,
  max_htlc_mtokens: '100000000',
  min_htlc_mtokens: '1000',
}];

// Make an LND invoice, as LND would have it, with blinded payment paths
const makeRpcInvoice = ({expiry, index, memo, value_msat}) => {
  const preimage = Buffer.alloc(32, index);
  const createdAt = Math.floor(Date.now() / 1000);

  const id = sha256(preimage);

  const unsigned = createUnsignedRequest({
    description: memo,
    created_at: new Date(createdAt * 1000).toISOString(),
    expires_at: new Date((createdAt + Number(expiry)) * 1000).toISOString(),
    features: [{bit: 9}, {bit: 14}, {bit: 17}],
    id: id.toString('hex'),
    mtokens: value_msat,
    network: 'regtest',
    paths: paymentPaths,
  });

  const {request} = createSignedRequest({
    hrp: unsigned.hrp,
    tags: unsigned.tags,
  });

  return {
    memo,
    value_msat,
    add_index: String(index),
    amt_paid_msat: '0',
    amt_paid_sat: '0',
    cltv_expiry: '80',
    creation_date: String(createdAt),
    description_hash: Buffer.alloc(0),
    expiry: String(expiry),
    features: {},
    htlcs: [],
    payment_addr: Buffer.alloc(32, 8),
    payment_request: request,
    private: false,
    r_hash: id,
    r_preimage: preimage,
    settle_date: '0',
    settle_index: '0',
    state: 'OPEN',
    value: String(BigInt(value_msat) / BigInt(1000)),
  };
};

// Make a fake LND that counts what it does, and stops signing after a number
// of signatures when there is a number. It makes invoices when it is paying,
// and tells `on_invoice` when it starts to make one.
const makeLnd = ({is_paying, key, on_invoice, signs}) => {
  const counts = {invoices: 0, record_keys: 0, replies: [], signatures: 0};
  const created = new Map();
  const subscription = new EventEmitter();
  const updates = new EventEmitter();

  subscription.cancel = () => {};
  updates.cancel = () => {};

  const lnd = {
    default: {
      addInvoice: (args, cbk) => {
        counts.invoices++;

        if (!!on_invoice) {
          on_invoice();
        }

        // Exit early when invoices are slow to create and fail
        if (!is_paying) {
          return setTimeout(() => cbk({details: 'failed'}), 50);
        }

        const invoice = makeRpcInvoice({
          expiry: args.expiry,
          index: counts.invoices,
          memo: args.memo,
          value_msat: args.value_msat,
        });

        created.set(invoice.r_hash.toString('hex'), invoice);

        return setTimeout(() => cbk(null, {
          add_index: invoice.add_index,
          payment_addr: invoice.payment_addr,
          payment_request: invoice.payment_request,
          r_hash: invoice.r_hash,
        }),
        50);
      },
      listPeers: ({}, cbk) => cbk(null, {
        peers: [{
          address: '127.0.0.1:9735',
          bytes_recv: '0',
          bytes_sent: '0',
          errors: [],
          features: {},
          flap_count: 0,
          inbound: false,
          last_flap_ns: '0',
          ping_time: '0',
          pub_key: peer,
          sat_recv: '0',
          sat_sent: '0',
          sync_type: 'ACTIVE_SYNC',
        }],
      }),
      // Replies are counted by their size
      sendOnionMessage: ({onion}, cbk) => {
        counts.replies.push(onion.length);

        return cbk();
      },
      lookupInvoice: ({r_hash}, cbk) => {
        return cbk(null, created.get(Buffer.from(r_hash).toString('hex')));
      },
      subscribeInvoices: () => updates,
      subscribeOnionMessages: () => subscription,
    },
    invoices: {},
    wallet: {
      deriveKey: ({key_family, key_index}, cbk) => cbk(null, {
        key_loc: {key_family, key_index},
        raw_key_bytes: hexAsBuffer(key || issuer),
      }),
    },
    signer: {
      deriveSharedKey: ({ephemeral_pubkey}, cbk) => {
        const point = Buffer.from(ephemeral_pubkey).toString('hex');

        // Count the shared keys derived to read the record
        if (point === recordPoint().public_key) {
          counts.record_keys++;
        }

        return cbk(null, {
          shared_key: sha256(pointMultiply(ephemeral_pubkey, secret, true)),
        });
      },
      // Sign the tagged hash of the message with the issuer key
      signMessage: ({msg, tag}, cbk) => {
        // Exit early when there are no more signatures
        if (counts.signatures === signs) {
          return cbk({details: 'failed'});
        }

        counts.signatures++;

        const tagHash = sha256(tag);

        const hash = sha256(Buffer.concat([tagHash, tagHash, msg]));

        return cbk(null, {
          signature: Buffer.from(signSchnorr(hash, Buffer.alloc(32, 5))),
        });
      },
    },
  };

  return {counts, created, lnd, subscription, updates};
};

// The record key is derived from the shared secret of the node key and the
// record point
const recordKey = keyForSecret({
  secret: sha256(pointMultiply(
    hexAsBuffer(recordPoint().public_key),
    secret,
    true
  ))
  .toString('hex'),
})
.key;

// Make a support service record, as this node would make it
const makeRecord = overrides => encodeRecord({
  offer,
  key: recordKey,
  key_index: 0,
  path_ids: [pathId],
  record_key_index: 0,
  ...overrides,
}).record;

const support = {record: makeRecord({})};

// Arguments of the test harness that are not arguments of the service
const harnessOptions = [
  'is_paying',
  'is_stopping_on_invoice',
  'key',
  'signs',
  'steps',
  'throwing',
];

// Start the service and give it messages at times, then summarize what it did
const serve = async args => {
  // The service can be stopped while an invoice is being made for a request
  const {counts, created, lnd, subscription, updates} = makeLnd({
    is_paying: args.is_paying,
    key: args.key,
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
  const supporters = [];

  const service = method({...support, lnd, ...options});

  // A listener can throw after it is told about an event
  const listen = (event, cbk) => service[event](n => {
    cbk(n);

    if ((args.throwing || []).includes(event)) {
      throw new Error('ListenerFailed');
    }
  });

  listen('end', () => isEnded.push(true));
  listen('error', ([code, message]) => errors.push([code, message]));
  listen('invoice', n => sent.push(n));
  listen('invoice_error', n => invoiceErrors.push(n));
  listen('menu', menu => menus.push(menu));
  listen('supporter', n => supporters.push([n.id, n.mtokens, n.payer_id]));

  // Each step moves the clock hours ahead and then gives messages, and pays
  // invoices that were made, by the order they were made in
  for (const {hours, paid, received} of args.steps || [{}]) {
    Date.now = () => now() + 1000 * 60 * 60 * (hours || 0);

    (received || []).forEach(n => subscription.emit('data', n));

    (paid || []).forEach(index => {
      const [invoice] = Array.from(created.values())
        .filter(n => n.add_index === String(index));

      updates.emit('data', {
        ...invoice,
        amt_paid_msat: invoice.value_msat,
        amt_paid_sat: invoice.value,
        settle_date: String(Math.floor(Date.now() / 1000)),
        settle_index: String(index),
        state: 'SETTLED',
      });
    });

    await wait();
  }

  Date.now = now;

  service.stop({});

  // The note of an invoice is opened with the preimage it is paid with
  const noteOf = n => supportNoteFor({
    invoice: n.invoice,
    preimage: created.get(n.id).r_preimage.toString('hex'),
  })
  .note;

  return {
    errors,
    menus,
    supporters,
    invoice_errors: invoiceErrors.map(n => {
      return [n.erroneous_field, n.message, n.payer_id];
    }),
    invoices: counts.invoices,
    is_ended: !!isEnded.length,
    record_keys: counts.record_keys,
    replies: counts.replies,
    sent: sent.map(n => {
      // Repeated requests are sent the same invoice as the first one
      const [first] = sent.filter(m => m.id === n.id);

      return {
        id: n.id,
        is_repeat: n.is_repeat,
        is_same: first.invoice === n.invoice,
        mtokens: n.mtokens,
        note: noteOf(n),
        payer_id: n.payer_id,
      };
    }),
    signatures: counts.signatures,
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
  supporters: [],
};

// What a service does when it ends because of a problem
const ended = message => ({
  ...idle,
  errors: [[400, message]],
  is_ended: true,
  signatures: 0,
});

// A listener that throws is an error
const listenerFailed = [500, 'UnexpectedErrorInListener'];

// The error sent back for a request to pay an amount of zero
const zeroAmount = ['82', 'ExpectedNonZeroAmountInInvoiceRequest', asKey(2)];

// The fake LND fails to make invoices, which is sent back as an error
const addInvoiceError = [undefined, 'AddInvoiceError', asKey(2)];
const addInvoiceFailure = [503, 'FailedToCreateInvoiceForSupporter'];

// The error sent back when the fake LND fails to sign an invoice
const signingFailed = 'UnexpectedErrorWhenSigningBytes';

// The first page of the menu, as sent to the payer of menu requests
const firstPage = {offer, page: 0, payer_id: asKey(4)};

// The error sent back for the menu of an offer with no menu here
const menuUnavailable = ['2000805805', 'SupportMenuUnavailable', asKey(4)];

// A request to pay the offer, which is the same each time it is sent
const request = makeRequest({});

// Steps where the service gets a request to pay the offer
const requested = [{received: [makeReceived(request)]}];

// Offers of the issuer that are listed on a menu without their paths
const listed = [1, 2, 3, 4, 5].map(n => makeOffer({
  description: `offer ${n}`,
  id: Buffer.alloc(16, n).toString('hex'),
}));

// Offers of another issuer are listed whole, needing more than one page
const others = [1, 2, 3, 4, 5, 6].map(n => makeOffer({
  description: `offer ${n}`,
  issuer_id: asKey(6),
}));

// A related support offer with a menu that lists two offers of the issuer
const episode = makeOffer({description: 'episode', id: '0e'.repeat(16)});
const guest = makeOffer({description: 'guest', id: '0f'.repeat(16)});
const tip = makeOffer({description: 'tip'});

const nested = [{offer: episode, related: [{offer: guest}, {offer: tip}]}];

const plain = makeOffer({description: 'plain'});

// An offer of the issuer that has expired, and the same offer before then
const expired = makeOffer({
  description: 'expiring',
  expires_at: '2025-01-01T00:00:00.000Z',
});

const expiring = makeOffer({
  description: 'expiring',
  expires_at: '2100-01-01T00:00:00.000Z',
});

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

// Menu requests that are not replied to
const badMenuRequest = withBadSignature(makeMenuRequest());
const otherMenuRequest = makeMenuRequest({
  to: makeOffer({description: 'other', id: '0c'.repeat(16)}),
});

// The id of an invoice made by the fake LND, by the order it was made in
const invoiceId = n => sha256(Buffer.alloc(32, n)).toString('hex');

// An invoice sent to the payer of the request to pay the offer
const sentInvoice = {
  id: invoiceId(1),
  is_repeat: false,
  is_same: true,
  mtokens: '1000',
  note: undefined,
  payer_id: asKey(2),
};

// Support offers of the issuer for levels of related menus
const level = [1, 2, 3, 4, 5].map(n => makeOffer({
  description: `level ${n}`,
  id: Buffer.alloc(16, n + 16).toString('hex'),
}));

// Nest offers so that the menu of each lists the one before it
const nest = offers => offers.reduce((related, offer) => {
  return [{offer, related}];
},
[]);

const otherSupport = makeOffer({
  description: 'other',
  id: '0e'.repeat(16),
  issuer_id: asKey(6),
});

const tests = [
  {
    args: {
      steps: [{received: [makeReceived(request), makeReceived(request)]}],
    },
    description: 'A request that is sent again shares the same invoice',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError, addInvoiceError],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      record: makeRecord({max_unpaid_invoices_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeRequest({payer: 2})),
          makeReceived(makeRequest({payer: 3})),
        ],
      }],
    },
    description: 'Unpaid invoices are limited',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [
        [undefined, 'TooManyUnpaidInvoices', asKey(3)],
        addInvoiceError,
      ],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {key: peer, steps: requested},
    description: 'A key index not for the offer issuer ends the service',
    expected: ended('ExpectedKeyIndexForSupportOfferIssuerId'),
  },
  {
    args: {
      record: makeRecord({key: Buffer.alloc(32, 3).toString('hex')}),
      steps: requested,
    },
    description: 'A record not made by this node ends the service',
    expected: ended('ExpectedServiceRecordMadeByThisNode'),
  },
  {
    args: {
      record: makeRecord({
        offer: createOffer({networks: ['regtest'], paths}).offer,
      }),
      steps: requested,
    },
    description: 'A record offer without an issuer id ends the service',
    expected: ended('ExpectedOfferWithIssuerIdInSupportRecord'),
  },
  {
    args: {record: makeRecord({offer: makeOffer({})}), steps: requested},
    description: 'An offer not labeled for support ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({offer: makeOffer({id: '0d'.repeat(16), type: '2'})}),
      steps: requested,
    },
    description: 'An offer for another service type ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({
        offer: makeOffer({id: '0d'.repeat(16), max_quantity: 5}),
      }),
      steps: requested,
    },
    description: 'An offer with a maximum quantity ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({
        offer: makeOffer({
          id: '0d'.repeat(16),
          networks: ['regtest', 'testnet'],
        }),
      }),
      steps: requested,
    },
    description: 'An offer for more than one network ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      record: makeRecord({offer: makeOffer({id: '0d'.repeat(16), major: 2})}),
      steps: requested,
    },
    description: 'A record offer of another major version ends the service',
    expected: ended('ExpectedSupportOfferInSupportRecord'),
  },
  {
    args: {
      related: [{offer}],
      steps: [{received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'A menu request is sent the menu',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {steps: [{received: [makeReceived(makeAmountlessRequest())]}]},
    description: 'A request without an amount is sent an error',
    expected: {
      ...idle,
      invoice_errors: [[
        '82',
        'ExpectedAmountInInvoiceRequestForOfferWithoutAmount',
        undefined,
      ]],
      replies: [1366],
    },
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeMenuRequest()),
          makeReceived(makeMenuRequest()),
        ],
      }],
    },
    description: 'Requests beyond the requests limit are ignored',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {related: 'offer'},
    description: 'Related offers are a list',
    error: 'ExpectedArrayOfRelatedOffersToServiceSupportOffer',
  },
  {
    args: {related: [{offer: 'offer'}]},
    description: 'Related offers are valid offers',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
  {
    args: {related: [{bip353_name: 'guest'}]},
    description: 'A reference needs a name and an issuer id',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
  {
    args: {
      related: [{
        offer: createOffer({
          issuer_id: asKey(6),
          networks: ['regtest'],
          paths: Array(4).fill(paths[0]),
        })
        .offer,
      }],
    },
    description: 'An offer with many paths is too large for a menu page',
    expected: ended('ExpectedRelatedOfferThatFitsOnAMenuPage'),
  },
  {
    args: {
      related: [{
        offer: createOffer({
          issuer_id: issuer,
          networks: ['regtest'],
          paths: Array(4).fill(paths[0]),
        })
        .offer,
      }],
      steps: [{received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'An offer of the issuer with many paths is listed pathless',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      is_paying: true,
      is_stopping_on_invoice: true,
      steps: [{}, {received: [makeReceived(request)]}],
    },
    description: 'A request being handled when the service stops gets nothing',
    expected: {...idle, invoices: 1},
  },
  {
    args: {steps: [{received: [makeReceived(request, 20)]}]},
    description: 'An error that does not fit in the reply is not sent',
    expected: {...idle, errors: [[503, 'ErrorSendingInvoiceError']]},
  },
  {
    args: {
      is_paying: true,
      signs: 1,
      steps: [{}, {received: [makeReceived(request)]}],
    },
    description: 'A request is sent an error when its invoice cannot be signed',
    expected: {
      ...idle,
      errors: [[503, 'FailedToSignInvoiceForSupporter']],
      invoice_errors: [[undefined, signingFailed, asKey(2)]],
      invoices: 1,
      replies: [1366],
    },
  },
  {
    args: {
      related: [{
        offer: createOffer({
          paths,
          description: 'x'.repeat(300),
          issuer_id: asKey(6),
          networks: ['regtest'],
        })
        .offer,
      }],
      steps: [{received: [makeReceived(makeMenuRequest(), 8)]}],
    },
    description: 'A page that does not fit in a regular reply is an error',
    expected: {
      ...idle,
      invoice_errors: [['2000805805', 'SupportMenuPageTooLarge', asKey(4)]],
      replies: [1366],
    },
  },
  {
    args: {support_note: 'a'.repeat(129)},
    description: 'A support note is short',
    error: 'ExpectedSupportNoteOfAtMost128BytesToServiceOffer',
  },
  {
    args: {support_note: ''},
    description: 'A support note is not empty',
    error: 'ExpectedSupportNoteOfAtMost128BytesToServiceOffer',
  },
  {
    args: {support_note: 'Thank you!'},
    description: 'A support note is short text',
    expected: idle,
  },
  {
    args: {record: undefined},
    description: 'A record is expected to service a support offer',
    error: 'ExpectedSupportRecordToServiceSupportOffer',
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeMenuRequest()),
          makeReceived(makeMenuRequest()),
          makeReceived(request),
        ],
      }],
    },
    description: 'Menu requests and requests to pay are limited apart',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError],
      invoices: 1,
      menus: [firstPage],
      replies: [1366, 1366],
    },
  },
  {
    args: {
      related: others.map(offer => ({offer})),
      steps: [{
        received: [
          makeReceived(makeMenuRequest({page: 0}), 3),
          makeReceived(makeMenuRequest({page: 1})),
          makeReceived(makeMenuRequest({page: 99})),
        ],
      }],
    },
    description: 'A menu that does not fit on a page is split into pages',
    expected: {
      ...idle,
      invoice_errors: [['2000805805', 'UnknownSupportMenuPage', asKey(4)]],
      menus: [firstPage, {...firstPage, page: 1}],
      replies: [1366, 1366, 1366],
      signatures: 3,
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeMenuRequest(), 9),
          makeReceived(makeMenuRequest(), 8),
        ],
      }],
    },
    description: 'Menu requests with long reply paths are ignored',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      steps: [
        {received: [makeReceived(makeMenuRequest())]},
        {hours: 23.5, received: [makeReceived(makeMenuRequest())]},
      ],
    },
    description: 'Signed menus are signed again before they expire',
    expected: {
      ...idle,
      menus: [firstPage, firstPage],
      replies: [1366, 1366],
      signatures: 2,
    },
  },
  {
    args: {
      steps: [
        {received: [makeReceived(makeMenuRequest())]},
        {hours: 23.5, received: [makeReceived(makeMenuRequest())]},
        {hours: 50, received: [makeReceived(makeMenuRequest())]},
      ],
    },
    description: 'An expired menu is signed again before it is sent',
    expected: {
      ...idle,
      menus: [firstPage, firstPage, firstPage],
      replies: [1366, 1366, 1366],
      signatures: 3,
    },
  },
  {
    args: {
      related: [{
        offer: createOffer({description: 'bitcoin', issuer_id: issuer})
          .offer,
      }],
    },
    description: 'Related offers are for the network of the offer',
    expected: ended('ExpectedRelatedOffersForSupportOfferNetwork'),
  },
  {
    args: {
      signs: 1,
      steps: [{}, {hours: 50, received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'A menu request without signed pages is sent an error',
    expected: {
      ...idle,
      errors: [[503, 'FailedToSignSupportMenu']],
      invoice_errors: [menuUnavailable],
      replies: [1366],
    },
  },
  {
    args: {record_key_indexes: [1, 2]},
    description: 'A record of an index that is not accepted ends the service',
    expected: {
      ...ended('UnexpectedRecordKeyIndexForSupportRecord'),
      record_keys: 0,
    },
  },
  {
    args: {record_key_indexes: [0]},
    description: 'A record of an accepted index is serviced',
    expected: idle,
  },
  {
    args: {record_key_indexes: [2147483648]},
    description: 'Record key indexes are not hardened',
    error: 'ExpectedRecordKeyIndexesToServiceSupportOffer',
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(25000)]})),
          makeReceived(makeRequest({
            records: [payerNote(25000), payerOffer(10)],
          })),
        ],
      }],
    },
    description: 'A request too large for its invoice is sent an error',
    expected: {
      ...idle,
      invoice_errors: [
        ['2000805807', 'PayerOfferTooLarge', asKey(2)],
        [undefined, 'InvoiceRequestTooLarge', asKey(2)],
      ],
      replies: [1366, 1366],
    },
  },
  {
    args: {
      related: listed.map(offer => ({offer})).concat({
        bip353_name: 'guest@example.com',
        issuer_id: asKey(6),
      }),
      steps: [{received: [makeReceived(makeMenuRequest())]}],
    },
    description: 'Offers of the issuer are listed without their paths',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {
      related: listed.map(offer => ({offer})),
      steps: [{
        received: [
          makeReceived(makeRequest({to: listed[0]})),
          makeReceived(makeMenuRequest({to: listed[0]})),
        ],
      }],
    },
    description: 'An offer listed without its paths is paid but has no menu',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [menuUnavailable, addInvoiceError],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(1200)]})),
          makeReceived(makeRequest({
            records: [payerNote(1200), payerOffer(10)],
          })),
        ],
      }],
    },
    description: 'A reply is not larger than its request',
    expected: {
      ...idle,
      invoice_errors: [
        [undefined, 'InvoiceTooLarge', asKey(2)],
        [undefined, 'InvoiceTooLarge', asKey(2)],
      ],
      replies: [1366, 1366],
    },
  },
  {
    args: {
      is_paying: true,
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(800)]})),
          makeReceived(makeRequest({payer: 3, records: [payerNote(800)]})),
        ],
      }],
    },
    description: 'The payer offer is named when the invoice fits without it',
    expected: {
      ...idle,
      invoice_errors: [
        ['2000805807', 'PayerOfferTooLarge', asKey(2)],
        [undefined, 'InvoiceTooLarge', asKey(3)],
      ],
      invoices: 2,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(makeRequest({records: [payerOffer(1200)]}), 1, true),
        ],
      }],
    },
    description: 'A large request can have a large invoice',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError],
      invoices: 1,
      replies: [1366],
    },
  },
  {
    args: {
      related: nested,
      steps: [{received: [makeReceived(makeMenuRequest({to: episode}))]}],
    },
    description: 'A related support offer of the issuer can have a menu',
    expected: {
      ...idle,
      menus: [{...firstPage, offer: episode}],
      replies: [1366],
      signatures: 2,
    },
  },
  {
    args: {
      related: nested,
      steps: [{
        received: [
          makeReceived(makeMenuRequest({to: guest})),
          makeReceived(makeRequest({to: tip})),
        ],
      }],
    },
    description: 'Offers on the menu of a related offer are answered here',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [menuUnavailable, addInvoiceError],
      invoices: 1,
      replies: [1366, 1366],
      signatures: 2,
    },
  },
  {
    args: {
      related: [{offer: episode}],
      steps: [{received: [makeReceived(makeRequest({to: plain}))]}],
    },
    description: 'An offer of the issuer that is not related is not answered',
    expected: {
      ...idle,
      invoice_errors: [
        [undefined, 'UnknownOfferForInvoiceRequest', asKey(2)],
      ],
      replies: [1366],
    },
  },
  {
    args: {
      related: [{offer: makeOffer({description: 'tip', issuer_id: asKey(6)})}],
      steps: [{
        received: [
          makeReceived(makeRequest({
            to: makeOffer({description: 'tip', issuer_id: asKey(6)}),
          })),
        ],
      }],
    },
    description: 'An offer of another issuer is not answered on these paths',
    expected: {
      ...idle,
      invoice_errors: [
        [undefined, 'UnknownOfferForInvoiceRequest', asKey(2)],
      ],
      replies: [1366],
    },
  },
  {
    args: {
      steps: [{
        received: [
          makeReceived(request),
          makeReceived(makeRequest({records: [payerNote(5)]})),
        ],
      }],
    },
    description: 'Requests that are not the same do not share an invoice',
    expected: {
      ...idle,
      errors: [addInvoiceFailure, addInvoiceFailure],
      invoice_errors: [addInvoiceError, addInvoiceError],
      invoices: 2,
      replies: [1366, 1366],
    },
  },
  {
    args: {
      related: [{offer: expired}],
      steps: [{
        received: [makeReceived(asExpired(makeRequest({to: expiring})))],
      }],
    },
    description: 'A request for an offer that has expired is sent an error',
    expected: {
      ...idle,
      invoice_errors: [[undefined, 'OfferExpired', asKey(2)]],
      replies: [1366],
    },
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [{
        received: [
          makeReceived(makeRequest({
            payer: 4,
            records: [{type: '2000805805', value: '0200'}],
          })),
          makeReceived(request),
          makeReceived(makeRequest({payer: 3})),
        ],
      }],
    },
    description: 'A menu request that is not understood uses the menu limit',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [
        ['2000805805', 'UnsupportedSupportMenuRequest', asKey(4)],
        addInvoiceError,
      ],
      invoices: 1,
      replies: [1366, 1366],
    },
  },
  {
    args: {related: [{offer: otherSupport, related: []}]},
    description: 'A support offer of another issuer cannot have a menu',
    expected: ended('ExpectedRelatedMenuOnlyForAnsweredSupportOffer'),
  },
  {
    args: {related: [{offer: plain, related: []}]},
    description: 'An offer that is not a support offer cannot have a menu',
    expected: ended('ExpectedRelatedMenuOnlyForAnsweredSupportOffer'),
  },
  {
    args: {related: [{offer, related: []}]},
    description: 'The support offer itself cannot have another menu',
    expected: ended('ExpectedOneMenuForEachRelatedSupportOffer'),
  },
  {
    args: {related: [{offer: plain, related: 'x'}]},
    description: 'Related offers of a related offer are a list',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
  {
    args: {is_paying: true, steps: requested},
    description: 'A request to pay is sent an invoice',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
    },
  },
  {
    args: {
      is_paying: true,
      steps: [
        {received: [makeReceived(request)]},
        {received: [makeReceived(request)]},
      ],
    },
    description: 'A request that is sent again is sent the same invoice',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, is_repeat: true}],
      signatures: 2,
    },
  },
  {
    args: {
      is_paying: true,
      steps: [{received: [makeReceived(request), makeReceived(request)]}],
    },
    description: 'Requests sent together share the invoice being made',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, is_repeat: true}],
      signatures: 2,
    },
  },
  {
    args: {is_paying: true, steps: requested, support_note: 'Thank you!'},
    description: 'An invoice has the support note',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [{...sentInvoice, note: 'Thank you!'}],
      signatures: 2,
    },
  },
  {
    args: {is_paying: true, steps: [...requested, {paid: [1]}]},
    description: 'A supporter has paid when the invoice is paid',
    expected: {
      ...idle,
      invoices: 1,
      replies: [1366],
      sent: [sentInvoice],
      signatures: 2,
      supporters: [[invoiceId(1), '1000', asKey(2)]],
    },
  },
  {
    args: {
      is_paying: true,
      steps: [...requested, {paid: [1]}, {received: [makeReceived(request)]}],
      throwing: ['invoice', 'supporter'],
    },
    description: 'A listener that throws does not end the service',
    expected: {
      ...idle,
      errors: [listenerFailed, listenerFailed, listenerFailed],
      invoices: 2,
      replies: [1366, 1366],
      sent: [sentInvoice, {...sentInvoice, id: invoiceId(2)}],
      signatures: 3,
      supporters: [[invoiceId(1), '1000', asKey(2)]],
    },
  },
  {
    args: {
      steps: [{received: [makeReceived(makeRequest({mtokens: '0'}))]}],
      throwing: ['error', 'invoice_error'],
    },
    description: 'An error listener that throws does not end the service',
    expected: {
      ...idle,
      errors: [listenerFailed],
      invoice_errors: [zeroAmount],
      replies: [1366],
    },
  },
  {
    args: {steps: [{received: [makeReceived(makeRequest({mtokens: '0'}))]}]},
    description: 'A request to pay an amount of zero is sent an error',
    expected: {...idle, invoice_errors: [zeroAmount], replies: [1366]},
  },
  {
    args: {
      steps: [
        {
          received: [
            makeReceived(badMenuRequest),
            makeReceived(otherMenuRequest),
          ],
        },
      ],
    },
    description: 'A menu request that is not valid is not replied to',
    expected: idle,
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [
        {
          received: [
            makeReceived(otherMenuRequest),
            makeReceived(makeMenuRequest()),
            makeReceived(request),
          ],
        },
      ],
    },
    description: 'A menu request not replied to uses the menu limit',
    expected: {
      ...idle,
      errors: [addInvoiceFailure],
      invoice_errors: [addInvoiceError],
      invoices: 1,
      replies: [1366],
    },
  },
  {
    args: {
      record: makeRecord({max_requests_per_hour: 1}),
      steps: [
        {
          received: [
            makeReceived(badMenuRequest, 9),
            makeReceived(makeMenuRequest()),
          ],
        },
      ],
    },
    description: 'A menu request with a long reply path is not counted',
    expected: {...idle, menus: [firstPage], replies: [1366]},
  },
  {
    args: {related: nest(level.slice(0, 4))},
    description: 'Related menus can be nested four levels deep',
    expected: {...idle, signatures: 5},
  },
  {
    args: {related: nest(level)},
    description: 'Related menus are not nested more than four levels deep',
    error: 'ExpectedRelatedOffersToServiceSupportOffer',
  },
];

tests.forEach(({args, description, error, expected}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(serve(args), new Error(error), 'Got error');
    }

    deepStrictEqual(await serve(args), expected, 'Got expected result');
  });
});
