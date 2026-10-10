const {encodeTlvStream} = require('bolt01');

const idBytes = require('./constants').lengthServiceIdBytes;
const numberAsTruncated = require('./number_as_truncated');
const {typeServiceId} = require('./constants');
const {typeServiceSequence} = require('./constants');
const {typeServiceType} = require('./constants');
const {typeVersion} = require('./constants');
const versionAsHex = require('./version_as_hex');

const isHex = n => typeof n === 'string' && /^([0-9a-f]{2})*$/i.test(n);
const isDigits = n => /^\d+$/.test(String(n));
const isSequence = n => isDigits(n) && BigInt(n) <= maxSequence;
const maxSequence = BigInt('18446744073709551615');
const isType = n => typeof n === 'string' && /^\d+$/.test(n);

/** Encode a service label, the value of the `offer_service` record that
  names the service and version of an offer

  The 16 byte `id` stays the same when the offer changes, and the `sequence`
  goes up each time it changes. A sequence of zero is left out.

  {
    [id]: <Service Id Hex String>
    [sequence]: <Service Sequence Number String>
    type: <Service Type Number String>
    version: <Service Version Number>
  }

  @throws
  <Error>

  @returns
  {
    encoded: <Service Label TLV Stream Hex String>
  }
*/
module.exports = ({id, sequence, type, version}) => {
  if (id !== undefined && (!isHex(id) || id.length / 2 !== idBytes)) {
    throw new Error('ExpectedServiceIdToEncodeServiceLabel');
  }

  if (!isType(type)) {
    throw new Error('ExpectedServiceTypeToEncodeServiceLabel');
  }

  if (sequence !== undefined && !isSequence(sequence)) {
    throw new Error('ExpectedServiceSequenceToEncodeServiceLabel');
  }

  const hasSequence = sequence !== undefined && BigInt(sequence) > BigInt(0);

  // A sequence of zero is left out
  const sequenceRecord = () => ({
    type: typeServiceSequence,
    value: numberAsTruncated({number: String(sequence)}).encoded,
  });

  return encodeTlvStream({
    records: [
      {
        type: typeServiceType,
        value: numberAsTruncated({number: type}).encoded,
      },
      {type: typeVersion, value: versionAsHex({version}).encoded},
      !id ? null : {type: typeServiceId, value: id.toLowerCase()},
      !hasSequence ? null : sequenceRecord(),
    ]
    .filter(n => !!n),
  });
};
