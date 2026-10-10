const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {createOffer} = require('invoices');
const {createSignedInvoiceRequest} = require('invoices');
const {createUnsignedInvoiceRequest} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');
const {signSchnorr} = require('tiny-secp256k1');

const {addServiceLabel} = require('./../../service_records');
const encodePayerOffer = require('./../../support/encode_payer_offer');
const encodeRecord = require('./../../support/encode_support_record');
const keyForSecret = require('./../../service_records/record_key_for_secret');
const payerOfferFor = require('./../../support/payer_offer_for_request');
const preimage = require('./../../support/payer_offer_signature_preimage');
const recordPoint = require('./../../service_records/record_point');
const signPayerOffer = require('./../../support/sign_payer_offer');
const verify = require('./../../support/verify_offer_reference');

const asKey = n => Buffer.from(pointFromScalar(Buffer.alloc(32, n)))
  .toString('hex');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const inFuture = '2100-01-01T00:00:00.000Z';
const inPast = '2025-01-01T00:00:00.000Z';
const issuer = asKey(2);
const payerId = asKey(4);
const serviceId = '0e'.repeat(16);
const sha256 = n => createHash('sha256').update(n).digest();

// The chain hash of bitcoin as offers name it, the genesis block hash reversed
const bitcoinChain = Buffer.from(
  '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  'hex'
)
.reverse()
.toString('hex');

const node = asKey(9);
const blinded = blindedPathFromHops({hops: [node]});
const {key} = blinded;
const paths = [{key, hops: blinded.path, introduction_node: node}];

// Label an offer as a support offer with a service id
const label = (offer, sequence) => addServiceLabel({
  offer,
  sequence,
  id: serviceId,
  type: '1',
  version: 1,
})
.offer;

// The support offer that is paid, made by the key of secret 1
const support = addServiceLabel({
  id: '0d'.repeat(16),
  offer: createOffer({paths, description: 'support', issuer_id: asKey(1)})
    .offer,
  type: '1',
  version: 1,
})
.offer;

// The offer of the payer, made by the key of secret 2
const payerOffer = createOffer({
  description: 'support me back',
  issuer_id: issuer,
}).offer;

// A support offer of the payer, made by the key of secret 2, in versions
const payerSupport = sequence => label(
  createOffer({paths, description: 'me', issuer_id: issuer}).offer,
  sequence
);

// Payer offer records
const expiryField = {type: '8', value: 'f4865700'};
const issuerField = {type: '4', value: issuer};
const nameField = {type: '2', value: '05616c6963650b6578616d706c652e636f6d'};
const offerField = {type: '0', value: parseOffer({offer: payerOffer}).encoded};
const pastExpiryField = {type: '8', value: '67748580'};
const sequenceField = {type: '10', value: '02'};
const serviceIdField = {type: '6', value: serviceId};
const shortSignatureField = {type: '240', value: '00'.repeat(63)};
const zeroSignatureField = {type: '240', value: '00'.repeat(64)};

// An odd record with a type after the signature
const afterSignature = {type: '241', value: '00'};

// A whole payer offer without its signature
const unsignedOffer = encodeTlvStream({records: [offerField]}).encoded;

// An offer of the payer that has expired
const expiredOffer = createOffer({
  description: 'expired',
  expires_at: inPast,
  issuer_id: issuer,
})
.offer;

// The payer offer field of an offer
const offerFieldOf = offer => ({
  type: '0',
  value: parseOffer({offer}).encoded,
});

// A reference to the payer support offer, as it is read from a request
const reference = {
  bip353_name: 'alice@example.com',
  issuer_id: issuer,
  network: 'bitcoin',
  service_id: serviceId,
};

// Sign payer offer fields for a payer id and network with a secret
const sign = ({fields, network, payer, secret}) => {
  const {hash} = preimage({
    network: network || 'bitcoin',
    payer_id: payer || payerId,
    unsigned: encodeTlvStream({records: fields}).encoded,
  });

  return Buffer.from(
    signSchnorr(hexAsBuffer(hash), secret || Buffer.alloc(32, 2))
  )
  .toString('hex');
};

// Make a payer offer record from its own fields
const withFields = fields => ({
  type: '2000805807',
  value: encodeTlvStream({records: fields}).encoded,
});

// Make a payer offer record of fields, signed over those fields
const signedFields = (fields, args) => withFields(fields.concat({
  type: '240',
  value: sign({fields, ...args}),
}));

// Make a signed request to pay the support offer with extra records
const makeRequest = extra => {
  const unsigned = createUnsignedInvoiceRequest({
    mtokens: '21000000',
    offer: support,
    payer_id: payerId,
  });

  const {records} = decodeTlvStream({encoded: unsigned.encoded});

  const {encoded} = encodeTlvStream({
    records: records.map(({type, value}) => ({type, value}))
      .concat(extra.map(({type, value}) => ({type, value}))),
  });

  return createSignedInvoiceRequest({
    encoded,
    secret: Buffer.alloc(32, 4).toString('hex'),
  })
  .encoded;
};

// Get the records of a TLV stream
const fieldsOf = encoded => {
  return decodeTlvStream({encoded}).records.map(({type, value}) => ({
    type,
    value,
  }));
};

// Encode a payer offer with a signature of zero bytes and get its records
const encode = args => {
  const {type, value} = encodePayerOffer({
    ...args,
    signature: zeroSignatureField.value,
  });

  return {type, records: fieldsOf(value)};
};

// Read the payer offer of a request to pay with records
const read = ({records}) => {
  return payerOfferFor({request: makeRequest(records)});
};

// The tagged hash of a preimage
const taggedHash = (tag, hex) => {
  const tagHash = sha256(Buffer.from(tag));

  return sha256(Buffer.concat([tagHash, tagHash, hexAsBuffer(hex)]))
    .toString('hex');
};

// The record of an offer of the payer, sealed with the key of node secret 7
const recordFor = offer => encodeRecord({
  key: keyForSecret({
    secret: sha256(pointMultiply(
      hexAsBuffer(recordPoint().public_key),
      Buffer.alloc(32, 7),
      true
    ))
    .toString('hex'),
  })
  .key,
  offer,
  key_index: 3,
  path_ids: ['0a'.repeat(32)],
  record_key_index: 0,
})
.record;

// Make a fake LND of node secret 7 with an issuer key of a secret
const makeLnd = issuerSecret => ({
  signer: {
    deriveSharedKey: ({ephemeral_pubkey}, cbk) => cbk(null, {
      shared_key: sha256(pointMultiply(
        ephemeral_pubkey,
        Buffer.alloc(32, 7),
        true
      )),
    }),
    signMessage: ({msg, tag}, cbk) => {
      const tagHash = sha256(tag);

      const hash = sha256(Buffer.concat([tagHash, tagHash, msg]));

      return cbk(null, {
        signature: Buffer.from(signSchnorr(hash, issuerSecret)),
      });
    },
  },
  wallet: {
    deriveKey: ({key_family, key_index}, cbk) => cbk(null, {
      key_loc: {key_family, key_index},
      raw_key_bytes: Buffer.from(pointFromScalar(issuerSecret)),
    }),
  },
});

// Sign the payer offer of the record and read it from a request to pay
const signFor = async ({offer, secret, ...args}) => {
  const signed = await signPayerOffer({
    ...args,
    lnd: makeLnd(Buffer.alloc(32, secret || 2)),
    payer_id: payerId,
    record: recordFor(offer || payerOffer),
  });

  return {offer: signed.offer, read: read({records: [signed]})};
};

const tests = [
  {
    args: {records: [signedFields([offerField])]},
    description: 'A signed payer offer is read from a request to pay',
    expected: {payer_offer: payerOffer},
    method: read,
  },
  {
    args: {records: []},
    description: 'A request without a payer offer has no payer offer',
    expected: {},
    method: read,
  },
  {
    args: {request: '00'},
    description: 'Something that is not a request has no payer offer',
    expected: {},
    method: payerOfferFor,
  },
  {
    args: {records: [signedFields([offerField, {type: '5', value: '00'}])]},
    description: 'An unknown odd record that is signed is read',
    expected: {payer_offer: payerOffer},
    method: read,
  },
  {
    args: {
      records: [
        withFields([
          offerField,
          afterSignature,
          {type: '240', value: sign({fields: [offerField, afterSignature]})},
        ]),
      ],
    },
    description: 'An unknown odd record after the signature is signed too',
    expected: {payer_offer: payerOffer},
    method: read,
  },
  {
    args: {
      records: [
        withFields([
          offerField,
          {type: '5', value: '00'},
          {type: '240', value: sign({fields: [offerField]})},
        ]),
      ],
    },
    description: 'A record that was not signed makes the payer offer unusable',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField], {network: 'testnet'})]},
    description: 'A payer offer signed for another network is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField], {payer: asKey(5)})]},
    description: 'A payer offer signed for another payer id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [signedFields([offerField], {secret: Buffer.alloc(32, 3)})],
    },
    description: 'A payer offer signed by another key than its issuer id',
    expected: {},
    method: read,
  },
  {
    args: {records: [withFields([offerField])]},
    description: 'A payer offer without a signature is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [withFields([offerField, shortSignatureField])],
    },
    description: 'A payer offer with a signature that is not 64 bytes',
    expected: {},
    method: read,
  },
  {
    args: {records: [withFields([zeroSignatureField])]},
    description: 'A payer offer without an offer is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, {type: '12', value: '00'}])]},
    description: 'A payer offer with an unknown even record is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, pastExpiryField])]},
    description: 'A payer offer with an expiry that has passed is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [signedFields([offerField, {type: '8', value: '00f4865700'}])],
    },
    description: 'A payer offer with an expiry that is not minimal is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [signedFields([offerFieldOf(createOffer({paths}).offer)])],
    },
    description: 'A payer offer of an offer without an issuer id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [{type: '2000805807', value: '0205'}]},
    description: 'A payer offer that is not a TLV stream is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [
        signedFields([
          offerFieldOf(createOffer({
            description: 'support me back on testnet',
            issuer_id: issuer,
            networks: ['testnet'],
          })
          .offer),
        ]),
      ],
    },
    description: 'A payer offer that cannot be paid on the network is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerFieldOf(expiredOffer)])]},
    description: 'A payer offer of an offer that has expired is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, expiryField])]},
    description: 'A payer offer with an expiry is read until it expires',
    expected: {expires_at: inFuture, payer_offer: payerOffer},
    method: read,
  },
  {
    args: {
      records: [
        signedFields([offerField, {type: '8', value: 'ffffffffffffffff'}]),
      ],
    },
    description: 'A payer offer with an expiry past the latest date is read',
    expected: {
      expires_at: '+275760-09-13T00:00:00.000Z',
      payer_offer: payerOffer,
    },
    method: read,
  },
  {
    args: {records: [signedFields([nameField, issuerField, serviceIdField])]},
    description: 'A payer offer can be a reference to an offer at a name',
    expected: {payer_offer_reference: reference},
    method: read,
  },
  {
    args: {
      records: [
        signedFields([nameField, issuerField, serviceIdField, sequenceField]),
      ],
    },
    description: 'A reference can have the sequence of the support offer',
    expected: {payer_offer_reference: {...reference, service_sequence: '2'}},
    method: read,
  },
  {
    args: {records: [signedFields([nameField, issuerField])]},
    description: 'A reference without a service id is any offer of the issuer',
    expected: {
      payer_offer_reference: {...reference, service_id: undefined},
    },
    method: read,
  },
  {
    args: {records: [signedFields([nameField, issuerField, expiryField])]},
    description: 'A reference is read with its expiry',
    expected: {
      expires_at: inFuture,
      payer_offer_reference: {...reference, service_id: undefined},
    },
    method: read,
  },
  {
    args: {records: [signedFields([nameField, issuerField, sequenceField])]},
    description: 'A sequence without a service id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, nameField, issuerField])]},
    description: 'A payer offer with an offer and a reference is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, nameField])]},
    description: 'A payer offer with an offer and a name is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, issuerField])]},
    description: 'A payer offer with an offer and an issuer id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([offerField, serviceIdField])]},
    description: 'A payer offer with an offer and a service id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([nameField])]},
    description: 'A reference with a name and no issuer id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([issuerField])]},
    description: 'A reference with an issuer id and no name is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [signedFields([{type: '2', value: '05616c'}, issuerField])],
    },
    description: 'A reference with a name that is not valid is ignored',
    expected: {},
    method: read,
  },
  {
    args: {records: [signedFields([nameField, {type: '4', value: '02'}])]},
    description: 'A reference with an issuer id that is not a key is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [
        signedFields([nameField, issuerField, {type: '6', value: '0e'}]),
      ],
    },
    description: 'A reference with a short service id is ignored',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [
        signedFields([nameField, issuerField], {secret: Buffer.alloc(32, 3)}),
      ],
    },
    description: 'A reference is signed by its issuer id',
    expected: {},
    method: read,
  },
  {
    args: {
      records: [signedFields([nameField, issuerField], {network: 'testnet'})],
    },
    description: 'A reference is signed for the network of the request',
    expected: {},
    method: read,
  },
  {
    args: {offer: payerOffer},
    description: 'A payer offer is the offer and its signature',
    expected: {type: '2000805807', records: [offerField, zeroSignatureField]},
    method: encode,
  },
  {
    args: {expires_at: inFuture, offer: payerOffer},
    description: 'A payer offer can have an expiry that is signed',
    expected: {
      records: [offerField, expiryField, zeroSignatureField],
      type: '2000805807',
    },
    method: encode,
  },
  {
    args: {
      bip353_name: 'alice@example.com',
      issuer_id: issuer,
      service_id: serviceId,
    },
    description: 'A reference is a name, an issuer id, and a service id',
    expected: {
      records: [nameField, issuerField, serviceIdField, zeroSignatureField],
      type: '2000805807',
    },
    method: encode,
  },
  {
    args: {
      bip353_name: 'alice@example.com',
      expires_at: inFuture,
      issuer_id: issuer,
      service_id: serviceId,
      service_sequence: '2',
    },
    description: 'The records of a reference are in the order of their types',
    expected: {
      records: [
        nameField,
        issuerField,
        serviceIdField,
        expiryField,
        sequenceField,
        zeroSignatureField,
      ],
      type: '2000805807',
    },
    method: encode,
  },
  {
    args: {
      bip353_name: 'alice@example.com',
      expires_at: inFuture,
      issuer_id: issuer,
    },
    description: 'A reference without a service id can have an expiry',
    expected: {
      records: [nameField, issuerField, expiryField, zeroSignatureField],
      type: '2000805807',
    },
    method: encode,
  },
  {
    args: {offer: createOffer({paths}).offer},
    description: 'A payer offer has an issuer id',
    error: new Error('ExpectedOfferWithIssuerIdToEncodePayerOffer'),
    method: encode,
  },
  {
    args: {bip353_name: 'a@b.c', offer: payerOffer},
    description: 'A payer offer is an offer or a reference, not both',
    error: new Error('ExpectedEitherOfferOrReferenceToEncodePayerOffer'),
    method: encode,
  },
  {
    args: {offer: payerOffer, service_sequence: '2'},
    description: 'A whole payer offer has no sequence of its own',
    error: new Error('ExpectedEitherOfferOrReferenceToEncodePayerOffer'),
    method: encode,
  },
  {
    args: {
      bip353_name: 'alice@example.com',
      issuer_id: issuer,
      service_sequence: '2',
    },
    description: 'A reference with a sequence has a service id',
    error: new Error('ExpectedServiceIdForServiceSequenceOfPayerOffer'),
    method: encode,
  },
  {
    args: {expires_at: 'not a date', offer: payerOffer},
    description: 'An expiry is a date',
    error: new Error('ExpectedExpiryDateToEncodePayerOffer'),
    method: encode,
  },
  {
    args: {expires_at: '1960-01-01', offer: payerOffer},
    description: 'An expiry is after the UNIX epoch',
    error: new Error('ExpectedExpiryAfterUnixEpochToEncodePayerOffer'),
    method: encode,
  },
  {
    args: {network: 'bitcoin', payer_id: payerId, unsigned: unsignedOffer},
    description: 'A payer offer signature is a tagged hash of the network',
    expected: {
      hash: taggedHash(
        'support-payer-offer-signature',
        bitcoinChain + payerId + unsignedOffer
      ),
      preimage: bitcoinChain + payerId + unsignedOffer,
      tag: 'support-payer-offer-signature',
    },
    method: preimage,
  },
  {
    args: {},
    description: 'A payer signs its own support offer from its record',
    expected: {offer: payerOffer, read: {payer_offer: payerOffer}},
    method: signFor,
  },
  {
    args: {bip353_name: 'alice@example.com'},
    description: 'A payer can sign a reference to its offer at a name',
    expected: {
      offer: payerOffer,
      read: {payer_offer_reference: {...reference, service_id: undefined}},
    },
    method: signFor,
  },
  {
    args: {expires_at: inFuture},
    description: 'A payer offer is signed with an expiry',
    expected: {
      offer: payerOffer,
      read: {expires_at: inFuture, payer_offer: payerOffer},
    },
    method: signFor,
  },
  {
    args: {expires_at: 'not a date'},
    description: 'A payer offer expiry is a date',
    error: [400, 'ExpectedExpiryDateToSignPayerOffer'],
    method: signFor,
  },
  {
    args: {expires_at: inPast},
    description: 'A payer offer expiry is in the future',
    error: [400, 'ExpectedFutureExpiryToSignPayerOffer'],
    method: signFor,
  },
  {
    args: {bip353_name: 'not a name'},
    description: 'A reference name is a BIP 353 name',
    error: [400, 'ExpectedBip353NameToSignPayerOffer'],
    method: signFor,
  },
  {
    args: {offer: expiredOffer},
    description: 'A payer offer is for an offer that has not expired',
    error: [400, 'ExpectedUnexpiredOfferToSignPayerOffer'],
    method: signFor,
  },
  {
    args: {secret: 3},
    description: 'A payer offer is signed by its issuer id key',
    error: [400, 'ExpectedIssuerIdKeyToSignPayerOffer'],
    method: signFor,
  },
  {
    args: {reference, offer: payerSupport()},
    description: 'An offer found at the name of a reference can be its offer',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {
      offer: createOffer({paths, description: 'no issuer'}).offer,
      reference: {bip353_name: 'alice@example.com', network: 'bitcoin'},
    },
    description: 'A reference without an issuer id is not for any offer',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      offer: payerSupport(),
      reference: {...reference, issuer_id: issuer.toUpperCase()},
    },
    description: 'Issuer ids of a reference are compared in any case',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {reference, offer: support},
    description: 'An offer of another issuer is not the offer of a reference',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      reference,
      offer: addServiceLabel({
        id: '0f'.repeat(16),
        offer: createOffer({paths, description: 'x', issuer_id: issuer})
          .offer,
        type: '1',
        version: 1,
      })
      .offer,
    },
    description: 'An offer with another service id is not the offer',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      reference,
      offer: label(createOffer({
        paths,
        description: 'me',
        issuer_id: issuer,
        networks: ['testnet'],
      })
      .offer),
    },
    description: 'A support offer on another network is not the offer',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      offer: payerSupport('1'),
      reference: {...reference, service_sequence: '2'},
    },
    description: 'A support offer older than a reference is not its offer',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      offer: payerSupport(),
      reference: {...reference, service_sequence: '2'},
    },
    description: 'A support offer with no sequence is older than a reference',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      offer: payerSupport('2'),
      reference: {...reference, service_sequence: '2'},
    },
    description: 'A support offer of the sequence of a reference is its offer',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {
      offer: payerSupport('9'),
      reference: {...reference, service_sequence: '2'},
    },
    description: 'A newer support offer than a reference is its offer',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {
      offer: payerOffer,
      reference: {...reference, service_id: undefined},
    },
    description: 'Any offer of the issuer is the offer of a plain reference',
    expected: {is_valid: true},
    method: verify,
  },
  {
    args: {
      offer: createOffer({
        description: 'testnet',
        issuer_id: issuer,
        networks: ['testnet'],
      })
      .offer,
      reference: {...reference, service_id: undefined},
    },
    description: 'An offer for another network is not a reference offer',
    expected: {is_valid: false},
    method: verify,
  },
  {
    args: {
      offer: createOffer({
        description: 'expired',
        expires_at: inPast,
        issuer_id: issuer,
      })
      .offer,
      reference: {...reference, service_id: undefined},
    },
    description: 'An offer that has expired is not the offer of a reference',
    expected: {is_valid: false},
    method: verify,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(async () => method(args), error, 'Got error');
    }

    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
