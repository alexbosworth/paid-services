const decodeRecords = require('./decode_records');
const hexAsVersion = require('./hex_as_version');
const knownTypes = require('./known_types').label;
const {lengthServiceIdBytes} = require('./constants');
const truncatedAsNumber = require('./truncated_as_number');
const {typeServiceId} = require('./constants');
const {typeServiceSequence} = require('./constants');
const {typeServiceType} = require('./constants');
const {typeVersion} = require('./constants');

const isEven = type => !(BigInt(type) % BigInt(2));
const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isUnknownEven = n => !knownTypes.includes(n.type) && isEven(n.type);
const numberOf = ({value}) => truncatedAsNumber({encoded: value}).number;

/** Decode a service label that names the service and version of an offer

  A label with a service id of a length other than 16 bytes is not valid.
  The sequence is only given when it is not zero.

  {
    encoded: <Service Label TLV Stream Hex String>
  }

  @throws
  <Error>

  @returns
  {
    [id]: <Service Id Hex String>
    [sequence]: <Service Sequence Number String>
    type: <Service Type Number String>
    version: <Service Version Number>
  }
*/
module.exports = ({encoded}) => {
  if (!isHex(encoded)) {
    throw new Error('ExpectedHexServiceLabelToDecode');
  }

  // Exit early when the label cannot be decoded
  try {
    decodeRecords({encoded});
  } catch (err) {
    throw new Error('ExpectedTlvStreamServiceLabel');
  }

  const {records} = decodeRecords({encoded});

  // Unknown even records cannot be ignored
  if (!!records.find(isUnknownEven)) {
    throw new Error('UnexpectedUnknownRequiredRecordInServiceLabel');
  }

  const serviceType = records.find(n => n.type === typeServiceType);
  const version = records.find(n => n.type === typeVersion);

  if (!serviceType || !version) {
    throw new Error('ExpectedTypeAndVersionInServiceLabel');
  }

  const id = records.find(n => n.type === typeServiceId);

  if (!!id && id.value.length / 2 !== lengthServiceIdBytes) {
    throw new Error('ExpectedServiceIdOf16BytesInServiceLabel');
  }

  const sequenceRecord = records.find(n => n.type === typeServiceSequence);

  // A sequence of zero is the same as a sequence that is left out
  const sequence = !sequenceRecord ? '0' : numberOf(sequenceRecord);

  return {
    type: truncatedAsNumber({encoded: serviceType.value}).number,
    version: hexAsVersion({encoded: version.value}).version,
    ...(!id ? {} : {id: id.value}),
    ...(sequence === '0' ? {} : {sequence}),
  };
};
