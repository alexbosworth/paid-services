const {createHash} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {blindedPathFromHops} = require('bolt04');
const {makeLnd} = require('mock-lnd');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');
const {pointMultiply} = require('tiny-secp256k1');

const {decodeRecords} = require('./../../service_records');
const decodeRecord = require('./../../support/decode_support_record');
const keyForSecret = require('./../../service_records/record_key_for_secret');
const method = require('./../../support/create_support_offer');
const {readRecordKeyIndex} = require('./../../service_records');
const {readServiceLabel} = require('./../../service_records');
const recordPoint = require('./../../service_records/record_point');
const suggestedAmounts = require('./../../support/offer_suggested_amounts');

const asKey = n => Buffer.from(pointFromScalar(n)).toString('hex');
const derived = asKey(Buffer.alloc(32, 2));
const peer = asKey(Buffer.alloc(32, 4));
const secret = Buffer.alloc(32, 1);
const identity = asKey(secret);
const sha256 = n => createHash('sha256').update(n).digest();

// The record key is derived from the shared secret of the node key and the
// record point
const recordKey = keyForSecret({
  secret: sha256(pointMultiply(
    Buffer.from(recordPoint().public_key, 'hex'),
    secret,
    true
  ))
  .toString('hex'),
})
.key;

const read = record => decodeRecord({record, key: recordKey});

const makeTestLnd = ({keys, locators} = {}) => {
  const lnd = makeLnd({});

  const {getInfo} = lnd.default;

  lnd.default.getInfo = (args, cbk) => getInfo(args, (err, res) => {
    return cbk(err, {...res, identity_pubkey: identity});
  });

  lnd.signer = {
    deriveSharedKey: ({ephemeral_pubkey, key_loc}, cbk) => {
      (locators || []).push(key_loc);

      return cbk(null, {
        shared_key: sha256(pointMultiply(ephemeral_pubkey, secret, true)),
      });
    },
  };

  // Keys by index can be looked up
  lnd.wallet.deriveKey = ({key_family, key_index}, cbk) => {
    const key = (keys || {})[key_index];

    if (!key) {
      return cbk([503, 'UnexpectedIndexLookup']);
    }

    return cbk(null, {
      key_loc: {key_family, key_index},
      raw_key_bytes: Buffer.from(key, 'hex'),
    });
  };

  lnd.wallet.deriveNextKey = ({}, cbk) => cbk(null, {
    key_loc: {key_family: 806, key_index: 3},
    raw_key_bytes: Buffer.from(derived, 'hex'),
  });

  return lnd;
};

// Complete paths through peers to self, as a caller could make them
const makePath = (introduction, n) => {
  const id = Buffer.alloc(32, n).toString('hex');

  const blinded = blindedPathFromHops({id, hops: [introduction, identity]});

  return {
    id,
    hops: blinded.path,
    introduction_node: introduction,
    key: blinded.key,
  };
};

const path1 = makePath(peer, 8);
const path2 = makePath(asKey(Buffer.alloc(32, 6)), 9);

// Describe a value that was not given by its size, since it is random
const given = (value, values) => {
  return values.includes(value) ? value : `${value.length / 2} random bytes`;
};

// Create a support offer and describe it and its record
const create = async ({keys, ...args}) => {
  const locators = [];

  const res = await method({...args, lnd: makeTestLnd({keys, locators})});

  const {id, ...label} = readServiceLabel({offer: res.offer});
  const offer = parseOffer({offer: res.offer});
  const record = read(res.record);

  const pathIds = (args.paths || []).map(n => n.id);

  return {
    label,
    locators,
    description: offer.description,
    is_offer_in_record: record.offer === res.offer,
    is_service_id_in_label: id === res.service_id,
    issuer_id: offer.issuer_id,
    key_index: record.key_index,
    max_requests_per_hour: record.max_requests_per_hour,
    max_unpaid_invoices_per_hour: record.max_unpaid_invoices_per_hour,
    path_ids: record.path_ids.map(n => given(n, pathIds)),
    paths: offer.paths.map(n => ({
      hops: n.hops.length,
      introduction_node: n.introduction_node,
    })),
    record_key_index: readRecordKeyIndex({record: res.record}).index,
    service_id: given(res.service_id, [args.service_id]),
    suggested: suggestedAmounts({offer: res.offer}),
    types: decodeRecords({encoded: offer.encoded}).records.map(n => n.type),
  };
};

// Create a support offer with the issuer id of another support offer
const createForIssuer = async args => {
  const {record} = await method({description: 'show', lnd: makeTestLnd()});

  return await create({...args, issuer_record: record});
};

// Create two support offers and see if their service ids are the same
const createTwo = async args => {
  const first = await method({...args, lnd: makeTestLnd()});
  const second = await method({...args, lnd: makeTestLnd()});

  return {is_same_service_id: first.service_id === second.service_id};
};

// A support offer created with nothing given
const created = {
  description: undefined,
  is_offer_in_record: true,
  is_service_id_in_label: true,
  issuer_id: derived,
  key_index: 3,
  label: {is_labeled: true, type: '1', version: 1},
  locators: [{key_family: 807, key_index: 0}],
  max_requests_per_hour: undefined,
  max_unpaid_invoices_per_hour: undefined,
  path_ids: ['32 random bytes'],
  paths: [{hops: 1, introduction_node: identity}],
  record_key_index: 0,
  service_id: '16 random bytes',
  suggested: {mtokens: []},
  types: ['16', '22', '1000805805'],
};

const tests = [
  {
    args: {description: 'support'},
    description: 'A support offer is created',
    expected: {
      ...created,
      description: 'support',
      types: ['10', '16', '22', '1000805805'],
    },
    method: create,
  },
  {
    args: {},
    description: 'A support offer can be created without a description',
    expected: created,
    method: create,
  },
  {
    args: {},
    description: 'Each new support offer has its own service id',
    expected: {is_same_service_id: false},
    method: createTwo,
  },
  {
    args: {paths: [path1, path2]},
    description: 'A support offer can use given blinded paths',
    expected: {
      ...created,
      path_ids: [path1.id, path2.id],
      paths: [
        {hops: 2, introduction_node: path1.introduction_node},
        {hops: 2, introduction_node: path2.introduction_node},
      ],
    },
    method: create,
  },
  {
    args: {max_unpaid_invoices_per_hour: 5},
    description: 'A support offer record has the unpaid invoices limit',
    expected: {...created, max_unpaid_invoices_per_hour: 5},
    method: create,
  },
  {
    args: {max_requests_per_hour: 50},
    description: 'A support offer record has the requests limit',
    expected: {...created, max_requests_per_hour: 50},
    method: create,
  },
  {
    args: {record_key_index: 3},
    description: 'An offer record is sealed with a record key index',
    expected: {
      ...created,
      locators: [{key_family: 807, key_index: 3}],
      record_key_index: 3,
    },
    method: create,
  },
  {
    args: {description: 'episode', keys: {3: derived}},
    description: 'A support offer can use the issuer id of another offer',
    expected: {
      ...created,
      description: 'episode',
      // The record key opens the issuer record and seals the new record
      locators: [
        {key_family: 807, key_index: 0},
        {key_family: 807, key_index: 0},
      ],
      types: ['10', '16', '22', '1000805805'],
    },
    method: createForIssuer,
  },
  {
    args: {keys: {3: asKey(Buffer.alloc(32, 7))}},
    description: 'An issuer record key has to be its offer issuer id',
    error: [400, 'ExpectedIssuerRecordKeyForItsOfferIssuerId'],
    method: createForIssuer,
  },
  {
    args: {issuer_record: '626f73ff00'},
    description: 'An issuer record has to be a valid record for the node',
    error: [400, 'ExpectedValidIssuerRecordForSupportOffer'],
    method: create,
  },
  {
    args: {suggested_mtokens: ['1000000', '5000000']},
    description: 'A support offer can have suggested amounts',
    expected: {
      ...created,
      suggested: {mtokens: ['1000000', '5000000']},
      types: ['16', '22', '1000805805', '1000805807'],
    },
    method: create,
  },
  {
    args: {suggested_amounts: ['500', '2000'], suggested_currency: 'USD'},
    description: 'A support offer can have suggested amounts in a currency',
    expected: {
      ...created,
      suggested: {amounts: ['500', '2000'], currency: 'USD', mtokens: []},
      types: ['16', '22', '1000805805', '1000805807'],
    },
    method: create,
  },
  {
    args: {service_id: '0d'.repeat(16)},
    description: 'A support offer can keep its service id as it changes',
    expected: {...created, service_id: '0d'.repeat(16)},
    method: create,
  },
  {
    args: {service_id: '0d'.repeat(16), service_sequence: 1},
    description: 'A changed support offer has a higher sequence',
    expected: {
      ...created,
      label: {is_labeled: true, sequence: '1', type: '1', version: 1},
      service_id: '0d'.repeat(16),
    },
    method: create,
  },
  {
    args: {max_requests_per_hour: 0},
    description: 'A requests limit is expected to be positive',
    error: [400, 'ExpectedPositiveMaxRequestsForSupportOffer'],
    method: create,
  },
  {
    args: {max_requests_per_hour: 1.5},
    description: 'A requests limit is expected to be a whole number',
    error: [400, 'ExpectedPositiveMaxRequestsForSupportOffer'],
    method: create,
  },
  {
    args: {max_unpaid_invoices_per_hour: 0},
    description: 'An unpaid invoices limit is expected to be positive',
    error: [400, 'ExpectedPositiveMaxUnpaidForSupportOffer'],
    method: create,
  },
  {
    args: {paths: path1},
    description: 'Paths are expected to be an array',
    error: [400, 'ExpectedArrayOfPathsForSupportOffer'],
    method: create,
  },
  {
    args: {paths: []},
    description: 'Paths are expected when paths are given',
    error: [400, 'ExpectedGivenPathsForSupportOffer'],
    method: create,
  },
  {
    args: {paths: [{...path1, id: undefined}]},
    description: 'A given path needs its path id',
    error: [400, 'ExpectedPathIdForGivenSupportOfferPath'],
    method: create,
  },
  {
    args: {paths: [{...path1, id: '0a'.repeat(15)}]},
    description: 'A given path id is at least 16 bytes',
    error: [400, 'ExpectedPathIdOfAtLeast16BytesForGivenPath'],
    method: create,
  },
  {
    args: {paths: [path1, {...path2, id: path1.id}]},
    description: 'Given paths need different path ids',
    error: [400, 'ExpectedUniquePathIdsForSupportOfferPaths'],
    method: create,
  },
  {
    args: {paths: [{...path1, hops: []}]},
    description: 'A given path needs hops',
    error: [400, 'ExpectedHopsInGivenSupportOfferPath'],
    method: create,
  },
  {
    args: {paths: [{...path1, introduction_node: undefined}]},
    description: 'A given path needs an introduction',
    error: [400, 'ExpectedIntroductionInGivenSupportOfferPath'],
    method: create,
  },
  {
    args: {paths: [{...path1, key: undefined}]},
    description: 'A given path needs a path key',
    error: [400, 'ExpectedPathKeyInGivenSupportOfferPath'],
    method: create,
  },
  {
    args: {suggested_mtokens: ['0']},
    description: 'Suggested amounts are not zero',
    error: [400, 'ExpectedSuggestedAmountsForSupportOffer'],
    method: create,
  },
  {
    args: {suggested_amounts: ['500']},
    description: 'Suggested amounts in a currency need their currency',
    error: [400, 'ExpectedSuggestedAmountsWithTheirCurrency'],
    method: create,
  },
  {
    args: {suggested_amounts: ['500'], suggested_currency: 'usd'},
    description: 'A currency of suggested amounts is an ISO 4217 code',
    error: [400, 'ExpectedSuggestedAmountsForSupportOffer'],
    method: create,
  },
  {
    args: {
      suggested_amounts: ['500'],
      suggested_currency: 'USD',
      suggested_mtokens: ['1000'],
    },
    description: 'Suggested amounts are in millisatoshis or in a currency',
    error: [400, 'ExpectedEitherSuggestedMtokensOrAmounts'],
    method: create,
  },
  {
    args: {service_id: '0d'},
    description: 'A service id is 16 bytes',
    error: [400, 'ExpectedServiceIdToCreateSupportOffer'],
    method: create,
  },
  {
    args: {service_sequence: -1},
    description: 'A service sequence is not negative',
    error: [400, 'ExpectedServiceSequenceToCreateSupportOffer'],
    method: create,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(method(args), error, 'Got error');
    }

    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
