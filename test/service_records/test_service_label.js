const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {createOffer} = require('invoices');
const {decodeTlvStream} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {parseOffer} = require('invoices');
const {pointFromScalar} = require('tiny-secp256k1');

const addServiceLabel = require('./../../service_records/add_service_label');
const decode = require('./../../service_records/decode_service_label');
const encode = require('./../../service_records/encode_service_label');
const readServiceLabel = require('./../../service_records/read_service_label');

const bufferAsHex = buffer => buffer.toString('hex');
const issuerKey = Buffer.from(pointFromScalar(Buffer.alloc(32, 1)));

const issuerId = bufferAsHex(issuerKey);

// Add a raw record to an offer
const withRecord = (offer, record) => {
  const {records} = decodeTlvStream({encoded: parseOffer({offer}).encoded});

  const {encoded} = encodeTlvStream({records: records.concat(record)});

  return parseOffer({encoded}).offer;
};

const id = '0d'.repeat(16);
const offer = createOffer({issuer_id: issuerId, networks: ['regtest']}).offer;

// Labels with a service type of 1 and a version of 1
const label = records => encodeTlvStream({
  records: [
    {type: '0', value: '01'},
    {type: '2', value: '01'},
  ]
  .concat(records),
})
.encoded;

// Add a label to an offer and get the label record and the offer metadata
const labelOffer = args => {
  const added = parseOffer({offer: addServiceLabel(args).offer});

  const {records} = decodeTlvStream({encoded: added.encoded});

  return {
    label: records.find(n => n.type === '1000805805').value,
    metadata: added.metadata,
  };
};

const tests = [
  {
    args: {type: '1', version: 3},
    description: 'A label has a service type and version',
    expected: {encoded: '000101020103'},
    method: encode,
  },
  {
    args: {encoded: '000101020103'},
    description: 'A label is decoded to what it was encoded with',
    expected: {type: '1', version: 3},
    method: decode,
  },
  {
    args: {id, type: '1', version: 1},
    description: 'A label can have a 16 byte service id',
    expected: {encoded: '000101020101' + '0410' + id},
    method: encode,
  },
  {
    args: {encoded: '000101020101' + '0410' + id},
    description: 'A service id is decoded from a label',
    expected: {id, type: '1', version: 1},
    method: decode,
  },
  {
    args: {id, sequence: '3', type: '1', version: 1},
    description: 'A label can have a sequence that goes up with each change',
    expected: {encoded: '000101020101' + '0410' + id + '060103'},
    method: encode,
  },
  {
    args: {encoded: '000101020101' + '0410' + id + '060103'},
    description: 'A sequence is decoded from a label',
    expected: {id, sequence: '3', type: '1', version: 1},
    method: decode,
  },
  {
    args: {sequence: 0, type: '1', version: 1},
    description: 'A sequence of zero is left out',
    expected: {encoded: '000101020101'},
    method: encode,
  },
  {
    args: {encoded: '000101020101' + '0600'},
    description: 'A sequence of zero in a label is the same as left out',
    expected: {type: '1', version: 1},
    method: decode,
  },
  {
    args: {encoded: label([{type: '5', value: '00'}])},
    description: 'Unknown odd records in a label are ignored',
    expected: {type: '1', version: 1},
    method: decode,
  },
  {
    args: {id: '0d', type: '1', version: 1},
    description: 'A service id to encode is 16 bytes',
    error: 'ExpectedServiceIdToEncodeServiceLabel',
    method: encode,
  },
  {
    args: {type: '1', version: 1.5},
    description: 'A version is a whole number',
    error: 'ExpectedVersionNumberToEncodeServiceVersion',
    method: encode,
  },
  {
    args: {sequence: '-1', type: '1', version: 1},
    description: 'A sequence is not negative',
    error: 'ExpectedServiceSequenceToEncodeServiceLabel',
    method: encode,
  },
  {
    args: {sequence: '18446744073709551616', type: '1', version: 1},
    description: 'A sequence fits in 64 bits',
    error: 'ExpectedServiceSequenceToEncodeServiceLabel',
    method: encode,
  },
  {
    args: {encoded: '000101020101' + '040f' + '0d'.repeat(15)},
    description: 'A service id to decode is 16 bytes',
    error: 'ExpectedServiceIdOf16BytesInServiceLabel',
    method: decode,
  },
  {
    args: {encoded: '000101'},
    description: 'A label needs a service type and a version',
    error: 'ExpectedTypeAndVersionInServiceLabel',
    method: decode,
  },
  {
    args: {encoded: label([{type: '8', value: '00'}])},
    description: 'Unknown even records in a label are rejected',
    error: 'UnexpectedUnknownRequiredRecordInServiceLabel',
    method: decode,
  },
  {
    args: {encoded: '00020001020101'},
    description: 'A service type is minimally encoded',
    error: 'UnexpectedLeadingZeroInTruncatedNumber',
    method: decode,
  },
  {
    args: {encoded: '000101020101' + '06020003'},
    description: 'A sequence is minimally encoded',
    error: 'UnexpectedLeadingZeroInTruncatedNumber',
    method: decode,
  },
  {
    args: {offer},
    description: 'An offer without a label is not labeled',
    expected: {is_labeled: false},
    method: readServiceLabel,
  },
  {
    args: {offer: addServiceLabel({offer, type: '1', version: 1}).offer},
    description: 'A label is added to an offer and read back from it',
    expected: {is_labeled: true, type: '1', version: 1},
    method: readServiceLabel,
  },
  {
    args: {offer: addServiceLabel({id, offer, type: '1', version: 1}).offer},
    description: 'A service id is read from an offer',
    expected: {id, is_labeled: true, type: '1', version: 1},
    method: readServiceLabel,
  },
  {
    args: {
      offer: addServiceLabel({id, offer, sequence: 4, type: '1', version: 1})
        .offer,
    },
    description: 'A sequence is read from an offer',
    expected: {id, is_labeled: true, sequence: '4', type: '1', version: 1},
    method: readServiceLabel,
  },
  {
    args: {
      offer: withRecord(offer, {
        type: '1000805805',
        value: '000101020101' + '040f' + '0d'.repeat(15),
      }),
    },
    description: 'An offer with a short service id has no valid label',
    expected: {is_labeled: true},
    method: readServiceLabel,
  },
  {
    args: {offer: withRecord(offer, {type: '1000805805', value: '0001'})},
    description: 'An offer with an invalid label is labeled without a service',
    expected: {is_labeled: true},
    method: readServiceLabel,
  },
  {
    args: {
      offer: addServiceLabel({
        offer: withRecord(offer, {type: '1000805807', value: '00'}),
        type: '1',
        version: 1,
      })
      .offer,
    },
    description: 'A label is put in order before records of higher types',
    expected: {is_labeled: true, type: '1', version: 1},
    method: readServiceLabel,
  },
  {
    args: {offer: 'lno1'},
    description: 'An offer is expected to read a label',
    error: 'ExpectedValidOfferToReadServiceLabel',
    method: readServiceLabel,
  },
  {
    args: {offer, type: '1', version: 1},
    description: 'A label is a record of the offer, without metadata',
    expected: {label: '000101020101', metadata: undefined},
    method: labelOffer,
  },
  {
    args: {
      offer: addServiceLabel({offer, type: '1', version: 1}).offer,
      type: '1',
      version: 1,
    },
    description: 'An offer with a label is not labeled again',
    error: 'UnexpectedExistingServiceLabelInOffer',
    method: addServiceLabel,
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
