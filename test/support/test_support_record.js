const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const decode = require('./../../support/decode_support_record');
const encode = require('./../../support/encode_support_record');
const {encodeServiceRecord} = require('./../../service_records');
const {listAsHex} = require('./../../service_records');

const issuer = Buffer.from(pointFromScalar(Buffer.alloc(32, 3)));
const key = Buffer.alloc(32, 1).toString('hex');
// Path ids are at least 16 bytes, so a path id of 15 bytes is too short
const pathIds = [Buffer.alloc(32, 2), Buffer.alloc(16, 3)].map(n => {
  return n.toString('hex');
});
const shortPathId = Buffer.alloc(15, 4).toString('hex');

const {offer} = createOffer({
  description: 'support',
  issuer_id: issuer.toString('hex'),
  networks: ['regtest'],
});

// Arguments to encode a record with
const base = {offer, key_index: 0, path_ids: pathIds, record_key_index: 0};

// Support data with a key index, path ids, and any extra records
const makeData = ({ids, index, records}) => encodeTlvStream({
  records: [
    {type: '0', value: parseOffer({offer}).encoded},
    {type: '2', value: index || ''},
    {type: '4', value: listAsHex({items: ids || [pathIds[0]]}).encoded},
  ].concat(records || []),
}).encoded;

// Make a service record around support data
const wrap = ({data, type, version}) => encodeServiceRecord({
  key,
  data: data || makeData({}),
  record_key_index: 0,
  type: type || '1',
  version: version || 1,
}).record;

const tests = [
  {
    args: {
      ...base,
      key_index: 7,
      max_requests_per_hour: 500,
      max_unpaid_invoices_per_hour: 25,
    },
    description: 'A record is decoded to what it was encoded with',
    expected: {
      offer,
      key_index: 7,
      max_requests_per_hour: 500,
      max_unpaid_invoices_per_hour: 25,
      path_ids: pathIds,
    },
  },
  {
    args: base,
    description: 'A record without limits has no limits',
    expected: {
      offer,
      key_index: 0,
      max_requests_per_hour: undefined,
      max_unpaid_invoices_per_hour: undefined,
      path_ids: pathIds,
    },
  },
  {
    args: {...base, key_index: 2147483647},
    description: 'The highest signing key index is below 2^31',
    expected: {
      offer,
      key_index: 2147483647,
      max_requests_per_hour: undefined,
      max_unpaid_invoices_per_hour: undefined,
      path_ids: pathIds,
    },
  },
  {
    description: 'A record with an unknown odd record is read',
    expected: {
      offer,
      key_index: 0,
      max_requests_per_hour: undefined,
      max_unpaid_invoices_per_hour: undefined,
      path_ids: [pathIds[0]],
    },
    record: wrap({data: makeData({records: [{type: '11', value: '00'}]})}),
  },
  {
    description: 'A service record of another service type is rejected',
    error: 'ExpectedSupportServiceRecord',
    record: wrap({type: '2'}),
  },
  {
    description: 'A record of another version is rejected',
    error: 'UnsupportedSupportServiceRecordVersion',
    record: wrap({version: 2}),
  },
  {
    description: 'Unknown even support records are rejected',
    error: 'UnexpectedUnknownRequiredRecordInSupportRecord',
    record: wrap({data: makeData({records: [{type: '10', value: '00'}]})}),
  },
  {
    description: 'A limit of unpaid invoices of zero is rejected',
    error: 'ExpectedPositiveLimitInSupportRecord',
    record: wrap({data: makeData({records: [{type: '6', value: ''}]})}),
  },
  {
    description: 'A limit of requests of zero is rejected',
    error: 'ExpectedPositiveLimitInSupportRecord',
    record: wrap({data: makeData({records: [{type: '8', value: ''}]})}),
  },
  {
    args: {...base, max_requests_per_hour: 0},
    description: 'A limit of zero is not encoded',
    error: 'ExpectedPositiveMaxRequestsToEncodeSupportRecord',
  },
  {
    args: {...base, key_index: 2147483648},
    description: 'A signing key index of 2^31 is not encoded',
    error: 'ExpectedKeyIndexToEncodeSupportRecord',
  },
  {
    args: {...base, path_ids: [pathIds[0], shortPathId]},
    description: 'A path id of less than 16 bytes is not encoded',
    error: 'ExpectedPathIdsOfAtLeast16BytesToEncodeSupportRecord',
  },
  {
    description: 'A record with a path id of less than 16 bytes is rejected',
    error: 'ExpectedPathIdsOfAtLeast16BytesInSupportRecord',
    record: wrap({data: makeData({ids: [pathIds[0], shortPathId]})}),
  },
  {
    description: 'A signing key index of 2^31 is rejected',
    error: 'ExpectedKeyIndexBelowMaximumInSupportRecord',
    record: wrap({data: makeData({index: '80000000'})}),
  },
];

tests.forEach(({args, description, error, expected, record}) => {
  test(description, () => {
    const read = () => decode({
      key,
      record: record || encode({key, ...args}).record,
    });

    if (!!error) {
      return throws(read, new Error(error), 'Got expected error');
    }

    deepStrictEqual(read(), expected, 'Got expected result');
  });
});
