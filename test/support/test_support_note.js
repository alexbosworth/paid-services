const {createHash} = require('node:crypto');
const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');
const {createSignedInvoice} = require('invoices');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoice} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const openNote = require('./../../support/open_support_note');
const openSupportNote = require('./../../support/support_note_for_invoice');
const sealNote = require('./../../support/seal_support_note');
const supportNoteKey = require('./../../support/support_note_key');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const sha256 = n => createHash('sha256').update(n).digest('hex');

const id = sha256(Buffer.alloc(32, 14));
const otherPreimage = '0f'.repeat(32);
const preimage = '0e'.repeat(32);
const salt = '0c'.repeat(16);

// The note `Thank you!` sealed to the preimage with the salt, as in the spec
const sealed = salt + '1277377bd4ee1c8bdba7fabb8485e432f1d244a34475ebbac207';

// The byte ff, which is not UTF-8 text, sealed to the preimage
const notUtf8 = '0d'.repeat(16) + '7b31b6a5ddc81924c0e859c3d219efc6d2';

// Make a signed invoice for the payment hash, with a sealed note or not
const makeInvoice = note => {
  const {offer} = createOffer({description: 'support', issuer_id: asKey(1)});

  const request = createSignedInvoiceRequest({
    encoded: createUnsignedInvoiceRequest({
      offer,
      mtokens: '1000',
      payer_id: asKey(2),
    })
    .encoded,
    secret: Buffer.alloc(32, 2).toString('hex'),
  });

  const unsigned = createUnsignedInvoice({
    id,
    encoded: request.encoded,
    paths: [{
      base_fee_mtokens: '1000',
      cltv_delta: 144,
      fee_rate: 100,
      hops: [{encrypted_data: '00', relay_key: asKey(3)}],
      introduction_node: asKey(4),
      key: asKey(5),
      max_htlc_mtokens: '100000000',
      min_htlc_mtokens: '1000',
    }],
    records: !note ? [] : [{type: '3000805805', value: note}],
  });

  const signature = signSchnorr(
    Buffer.from(unsigned.hash, 'hex'),
    Buffer.alloc(32, 1)
  );

  return createSignedInvoice({
    encoded: unsigned.encoded,
    signature: Buffer.from(signature).toString('hex'),
  })
  .invoice;
};

// Seal a note with a random salt and open it again
const sealAndOpen = ({note}) => {
  return openNote({preimage, encoded: sealNote({note, preimage}).encoded});
};

const tests = [
  {
    args: {preimage, salt},
    description: 'The key is the tagged hash of the preimage and the salt',
    expected: {
      key: 'ba1e5d0f1417a2fcf124eb54fcfb0f169b81fefe4fcaff667ba06f213b27a2af',
    },
    method: supportNoteKey,
  },
  {
    args: {preimage, salt: '0c'.repeat(15)},
    description: 'A salt is 16 bytes',
    error: 'ExpectedSaltForSupportNoteKey',
    method: supportNoteKey,
  },
  {
    args: {preimage, salt, note: 'Thank you!'},
    description: 'A note is sealed after its salt, with its tag after it',
    expected: {encoded: sealed},
    method: sealNote,
  },
  {
    args: {preimage, note: ''},
    description: 'An empty note is not sealed',
    error: 'ExpectedNoteTextToSealSupportNote',
    method: sealNote,
  },
  {
    args: {preimage, note: 'a'.repeat(129)},
    description: 'A note longer than 128 bytes is not sealed',
    error: 'ExpectedShorterNoteToSealSupportNote',
    method: sealNote,
  },
  {
    args: {preimage, note: 'Thank you!'},
    description: 'A note is sealed with a new salt each time',
    expected: {is_same: false},
    method: args => ({
      is_same: sealNote(args).encoded === sealNote(args).encoded,
    }),
  },
  {
    args: {note: 'a'.repeat(128)},
    description: 'The longest note is sealed and opened',
    expected: {note: 'a'.repeat(128)},
    method: sealAndOpen,
  },
  {
    args: {note: '\ufeffThank you!'},
    description: 'A note that starts with a byte order mark opens unchanged',
    expected: {note: '\ufeffThank you!'},
    method: sealAndOpen,
  },
  {
    args: {preimage, encoded: sealed},
    description: 'A note is opened with the payment preimage',
    expected: {note: 'Thank you!'},
    method: openNote,
  },
  {
    args: {encoded: sealed, preimage: otherPreimage},
    description: 'A note is not opened with another preimage',
    error: 'ExpectedSupportNoteSealedToPaymentPreimage',
    method: openNote,
  },
  {
    args: {preimage, encoded: '0d' + sealed.slice(2)},
    description: 'A note with a changed salt is not opened',
    error: 'ExpectedSupportNoteSealedToPaymentPreimage',
    method: openNote,
  },
  {
    args: {preimage, encoded: notUtf8},
    description: 'A note that is not UTF-8 text is not opened',
    error: 'ExpectedUtf8TextInSupportNote',
    method: openNote,
  },
  {
    args: {preimage, encoded: '00'.repeat(32)},
    description: 'A salt and a tag with no text is not a note',
    error: 'ExpectedLongerSealedSupportNote',
    method: openNote,
  },
  {
    args: {preimage, encoded: '00'.repeat(161)},
    description: 'A sealed note longer than 160 bytes is not opened',
    error: 'ExpectedShorterSealedSupportNote',
    method: openNote,
  },
  {
    args: {preimage, invoice: makeInvoice(sealed)},
    description: 'The note of a paid invoice is opened with its preimage',
    expected: {note: 'Thank you!'},
    method: openSupportNote,
  },
  {
    args: {preimage, invoice: makeInvoice()},
    description: 'An invoice without a note has no note',
    expected: {},
    method: openSupportNote,
  },
  {
    args: {
      preimage,
      invoice: makeInvoice(sealNote({
        note: 'Thank you!',
        preimage: otherPreimage,
      })
      .encoded),
    },
    description: 'A note that cannot be opened is no note',
    expected: {},
    method: openSupportNote,
  },
  {
    args: {invoice: makeInvoice(sealed), preimage: otherPreimage},
    description: 'A preimage of another payment hash is rejected',
    error: 'ExpectedPaymentPreimageOfInvoiceToOpenSupportNote',
    method: openSupportNote,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
