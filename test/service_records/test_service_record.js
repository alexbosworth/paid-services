const {createCipheriv} = require('node:crypto');
const {createDecipheriv} = require('node:crypto');
const {createHmac} = require('node:crypto');
const {deepStrictEqual, rejects} = require('node:assert/strict');
const {test} = require('node:test');

const {encodeTlvStream} = require('bolt01');

const decode = require('./../../service_records/decode_service_record');
const encode = require('./../../service_records/encode_service_record');
const getRecordKey = require('./../../service_records/get_record_key');
const keyForSecret = require('./../../service_records/record_key_for_secret');
const readKeyIndex = require('./../../service_records/read_record_key_index');
const recordPoint = require('./../../service_records/record_point');
const sealKeyForSalt = require('./../../service_records/seal_key_for_salt');

const bufferAsHex = buffer => buffer.toString('hex');
const data = '0001aa';
const key = bufferAsHex(Buffer.alloc(32, 1));
const nonce = Buffer.alloc(12);
const salt = bufferAsHex(Buffer.alloc(32, 3));
const version = 3;

// Make a record with its own records, sealing the data over them
const sealRecords = (records, sealKey) => {
  const associated = '626f73ff' + encodeTlvStream({records}).encoded;

  const derived = sealKeyForSalt({salt, key: sealKey || key}).key;

  const cipher = createCipheriv(
    'chacha20-poly1305',
    Buffer.from(derived, 'hex'),
    nonce,
    {authTagLength: 16}
  );

  cipher.setAAD(Buffer.from(associated, 'hex'), {plaintextLength: 3});

  const sealed = Buffer.concat([
    cipher.update(Buffer.from(data, 'hex')),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const all = records.concat({type: '8', value: bufferAsHex(sealed)});

  const sorted = all.sort((a, b) => Number(a.type) - Number(b.type));

  return '626f73ff' + encodeTlvStream({records: sorted}).encoded;
};

const fields = [
  {type: '0', value: '01'},
  {type: '2', value: '03'},
  {type: '4', value: '05'},
  {type: '6', value: salt},
];

const otherSalt = bufferAsHex(Buffer.alloc(32, 4));
const prefix = '626f73ff';

// Arguments to encode a record with
const args = {data, key, version, record_key_index: 0, type: '1'};

// A record with a key index of a value
const withIndex = value => sealRecords([
  fields[0],
  fields[1],
  {type: '4', value},
  fields[3],
]);

// The HMAC of a salt with the record key
const hmac = n => {
  const hash = createHmac('sha256', Buffer.from(key, 'hex'));

  return hash.update(Buffer.from(n, 'hex')).digest('hex');
};

// Encode a record and decode it with the record key
const seal = n => decode({key, record: encode(n).record});

// Encode a record, change it, and decode it with a record key
const sealChanged = ({change, record_key, ...n}) => decode({
  key: record_key || key,
  record: change(encode(n).record),
});

// Encode a record and see what it shows
const sealAndLook = n => {
  const {record} = encode(n);

  return {
    is_data_shown: record.includes(n.data),
    is_prefixed: record.startsWith(prefix + '0001'),
    is_same_record_again: encode(n).record === record,
  };
};

// Encode a record and read its key index without the record key
const sealAndReadIndex = n => readKeyIndex({record: encode(n).record});

// Encode a record with a salt and open its sealed data by hand
const sealAndOpen = n => {
  const {record} = encode(n);

  const header = encodeTlvStream({
    records: [
      {type: '0', value: '01'},
      {type: '2', value: '03'},
      {type: '4', value: ''},
      {type: '6', value: n.salt},
    ],
  });

  const start = prefix.length + header.encoded.length + '0813'.length;

  const sealed = Buffer.from(record.slice(start), 'hex');

  const decipher = createDecipheriv(
    'chacha20-poly1305',
    Buffer.from(hmac(n.salt), 'hex'),
    nonce,
    {authTagLength: 16}
  );

  decipher.setAAD(Buffer.from(prefix + header.encoded, 'hex'), {
    plaintextLength: sealed.length - 16,
  });

  decipher.setAuthTag(sealed.subarray(sealed.length - 16));

  const opened = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);

  return {
    data: bufferAsHex(opened),
    is_header: record.startsWith(prefix + header.encoded),
  };
};

// Get a record key from a signer that counts the keys it derives
const getKey = async ({index}) => {
  let derived = 0;

  const lnd = {signer: {deriveSharedKey: ({}, cbk) => cbk(++derived)}};

  try {
    await getRecordKey({index, lnd});
  } catch (err) {
    return {derived, err};
  }
};

// Derive the record key of a secret and see what it is like
const keyOf = ({secret}) => {
  const derived = keyForSecret({secret}).key;

  return {
    bytes: derived.length / 2,
    is_same_again: keyForSecret({secret}).key === derived,
    is_secret: derived === secret,
  };
};

// A record that has an unknown odd record before its sealed data
const before = sealRecords(fields.concat({type: '7', value: '00'}));

// A record that has an unknown odd record after its sealed data
const after = sealRecords(fields.concat({type: '241', value: '00'}));

const tests = [
  {
    args,
    description: 'A record is decoded to what it was encoded with',
    expected: {data, version, record_key_index: 0, type: '1'},
    method: seal,
  },
  {
    args: {...args, data: 'ab'.repeat(20)},
    description: 'A record does not show its data and has its own salt',
    expected: {
      is_data_shown: false,
      is_prefixed: true,
      is_same_record_again: false,
    },
    method: sealAndLook,
  },
  {
    args: {...args, change: n => n, record_key: '09'.repeat(32)},
    description: 'A record made with another key is rejected',
    error: 'ExpectedServiceRecordMadeByThisNode',
    method: sealChanged,
  },
  {
    args: {
      ...args,
      change: n => n.replace(/^626f73ff000101/, '626f73ff000102'),
    },
    description: 'A record with a changed service type is rejected',
    error: 'ExpectedServiceRecordMadeByThisNode',
    method: sealChanged,
  },
  {
    args: {
      ...args,
      change: n => n.slice(0, -2) + (n.slice(-2) === '00' ? '01' : '00'),
    },
    description: 'A record with changed sealed data is rejected',
    error: 'ExpectedServiceRecordMadeByThisNode',
    method: sealChanged,
  },
  {
    args: {...args, change: n => n.slice(prefix.length)},
    description: 'A record starts with the paid services prefix',
    error: 'ExpectedPaidServicesPrefixForServiceRecord',
    method: sealChanged,
  },
  {
    args: {...args, record_key_index: 7},
    description: 'A record has the index of the key it was sealed with',
    expected: {data, version, record_key_index: 7, type: '1'},
    method: seal,
  },
  {
    args: {...args, record_key_index: 7},
    description: 'A record key index is read without the record key',
    expected: {index: 7},
    method: sealAndReadIndex,
  },
  {
    args: {
      ...args,
      change: n => n.replace('040107', '040108'),
      record_key_index: 7,
    },
    description: 'A record key index is associated data',
    error: 'ExpectedServiceRecordMadeByThisNode',
    method: sealChanged,
  },
  {
    args: {...args, record_key_index: undefined},
    description: 'A record key index is expected',
    error: 'ExpectedRecordKeyIndexToEncodeServiceRecord',
    method: encode,
  },
  {
    args: {...args, salt, record_key_index: 2147483647},
    description: 'A record key index can be just below 2^31',
    expected: {index: 2147483647},
    method: sealAndReadIndex,
  },
  {
    args: {...args, salt, record_key_index: 2147483648},
    description: 'A record key index is below 2^31',
    error: 'ExpectedRecordKeyIndexToEncodeServiceRecord',
    method: encode,
  },
  ...['80000000', 'ffffffffffffffff'].map(value => ({
    args: {record: withIndex(value)},
    description: `A record key index of ${value} is not read`,
    error: 'ExpectedRecordKeyIndexBelowMaximumInServiceRecord',
    method: readKeyIndex,
  })),
  ...['80000000', 'ffffffffffffffff'].map(value => ({
    args: {key, record: withIndex(value)},
    description: `A record with a key index of ${value} is not opened`,
    error: 'ExpectedRecordKeyIndexBelowMaximumInServiceRecord',
    method: decode,
  })),
  {
    args: {index: 2147483648},
    description: 'No key is derived for an index that is too high',
    expected: {
      derived: 0,
      err: [400, 'ExpectedIndexBelowMaximumToGetServiceRecordKey'],
    },
    method: getKey,
  },
  {
    args: {key, record: prefix + encodeTlvStream({records: fields}).encoded},
    description: 'A record needs sealed data',
    error: 'ExpectedSealedDataInServiceRecord',
    method: decode,
  },
  {
    args: {key, record: sealRecords(fields.slice(0, 3))},
    description: 'A record needs a salt',
    error: 'ExpectedSaltInServiceRecord',
    method: decode,
  },
  {
    args: {
      key,
      record: sealRecords(fields.slice(0, 3).concat({
        type: '6',
        value: salt.slice(2),
      })),
    },
    description: 'A salt is 32 bytes',
    error: 'ExpectedSaltInServiceRecord',
    method: decode,
  },
  {
    args: {key, salt},
    description: 'The sealing key is the HMAC of the salt with the record key',
    expected: {key: hmac(salt)},
    method: sealKeyForSalt,
  },
  {
    args: {key, salt: otherSalt},
    description: 'Another salt has another sealing key',
    expected: {key: hmac(otherSalt)},
    method: sealKeyForSalt,
  },
  {
    args: {...args, salt, version},
    description: 'Each record is sealed with its own key and a zero nonce',
    expected: {data, is_header: true},
    method: sealAndOpen,
  },
  {
    args: {key, record: sealRecords(fields.concat({type: '10', value: '00'}))},
    description: 'Unknown even records are rejected',
    error: 'UnexpectedUnknownRequiredRecordInServiceRecord',
    method: decode,
  },
  {
    args: {key, record: before},
    description: 'Unknown odd records before the sealed data are ignored',
    expected: {data, version, record_key_index: 5, type: '1'},
    method: decode,
  },
  {
    args: {key, record: before.replace(/070100(08)/, '$1')},
    description: 'A record is not opened without its unknown records',
    error: 'ExpectedServiceRecordMadeByThisNode',
    method: decode,
  },
  {
    args: {key, record: after},
    description: 'Unknown odd records after the sealed data are ignored',
    expected: {data, version, record_key_index: 5, type: '1'},
    method: decode,
  },
  {
    args: {key, record: after.replace(/f10100$/, 'f10101')},
    description: 'Unknown odd records after the sealed data are associated',
    error: 'ExpectedServiceRecordMadeByThisNode',
    method: decode,
  },
  {
    args: {
      key,
      record: sealRecords([
        fields[0],
        {type: '2', value: '0003'},
        fields[2],
        fields[3],
      ]),
    },
    description: 'A version is expected to be a minimal number',
    error: 'ExpectedVersionNumberInServiceRecord',
    method: decode,
  },
  {
    args: {},
    description: 'The record point is a point that is always the same',
    expected: {
      public_key: '022cc75db0208e2d2daa3ccfd76c011cd9ec889334e355dfd9' +
        '6bd1b1840f52c377',
    },
    method: recordPoint,
  },
  {
    args: {secret: bufferAsHex(Buffer.alloc(32, 7))},
    description: 'The record key is derived from the record secret with a tag',
    expected: {bytes: 32, is_same_again: true, is_secret: false},
    method: keyOf,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, async () => {
    if (!!error) {
      return await rejects(async () => method(args), new Error(error));
    }

    deepStrictEqual(await method(args), expected, 'Got expected result');
  });
});
