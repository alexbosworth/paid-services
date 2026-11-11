const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');

const decode = require('./../../support/decode_support_record');
const encode = require('./../../support/encode_support_record');
const {encodeServiceRecord} = require('./../../service_records');
const {listAsHex} = require('./../../service_records');

const key = '01'.repeat(32);
const {keys} = Object;
const offer = 'lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrc2qaeh2ursdae8g93pqff3lesxsy69q0f8yvfnyf7gv7kglfkg83fhaxjyc0zmm0wtrl3nw';
const pathIds = ['02'.repeat(32), '03'.repeat(16)];
const shortPathId = '04'.repeat(15);

// Make arguments to encode a record with, replacing defaults with overrides
const makeArgs = overrides => {
  const args = {offer, key_index: 0, path_ids: pathIds, record_key_index: 0};

  keys(overrides).forEach(k => args[k] = overrides[k]);

  return args;
};

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
    args: makeArgs({
      key_index: 7,
      max_requests_per_hour: 500,
      max_unpaid_invoices_per_hour: 25,
    }),
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
    args: makeArgs({}),
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
    args: makeArgs({key_index: 2147483647}),
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
    args: makeArgs({max_requests_per_hour: 0}),
    description: 'A limit of zero is not encoded',
    error: 'ExpectedPositiveMaxRequestsToEncodeSupportRecord',
  },
  {
    args: makeArgs({key_index: 2147483648}),
    description: 'A signing key index of 2^31 is not encoded',
    error: 'ExpectedKeyIndexToEncodeSupportRecord',
  },
  {
    args: makeArgs({path_ids: [pathIds[0], shortPathId]}),
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
