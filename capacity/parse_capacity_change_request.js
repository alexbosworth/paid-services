const {chanFormat} = require('bolt07');
const {decodeBigSize} = require('bolt01');

const channelIdHexLength = 16;
const decodeNumber = encoded => BigInt(decodeBigSize({encoded}).decoded);
const defaultRecord = {value: '00'};
const findChannelRecord = records => records.find(n => n.type === '2');
const findDecreaseRecord = records => records.find(n => n.type === '3');
const findIncreaseRecord = records => records.find(n => n.type === '4');
const findMigrationRecord = records => records.find(n => n.type === '6');
const findRequestIdRecord = records => records.find(n => n.type === '1');
const findTypeRecord = records => records.find(n => n.type === '5');
const findVersionRecord = records => records.find(n => n.type === '0');
const hexAsNumber = n => Buffer.from(n, 'hex').readUInt8();
const idHexLength = 64;
const isPublicKey = n => !!n && /^0[2-3][0-9A-F]{64}$/i.test(n);
const knownVersions = ['01'];
const tooLarge = BigInt(Number.MAX_SAFE_INTEGER);

/** Parse a capacity change request

  {
    from: <From Public Key Hex String>
    [records]: [{
      type: <Record Type Number String>
      value: <Record Hex Encoded Value String>
    }]
  }

  @returns
  {
    [request]: {
      channel: <Standard Format Channel Id String>
      [decrease]: <Reduce Capacity Tokens Number>
      from: <From Node Public Key Id Hex String>
      id: <Change Request Id Hex String>
      [increase]: <Add Capacity Tokens Number>
      [type]: <Intended Replacement Channel Channel Type Flags Number>
      [to]: <Replace Channel with New Peer with Identity Public Key Hex String>
    }
  }
*/
module.exports = ({from, records}) => {
  // Exit early when there are no records
  if (!records) {
    return {};
  }

  const versionRecord = findVersionRecord(records);

  // Exit early when the request is an unknown version
  if (!!versionRecord && !knownVersions.includes(versionRecord.value)) {
    return {};
  }

  const channelRecord = findChannelRecord(records);

  // Exit early when there is no channel
  if (!channelRecord || channelRecord.value.length !== channelIdHexLength) {
    return {};
  }

  // Make sure the channel id is a regular one
  try {
    chanFormat({id: channelRecord.value});
  } catch (err) {
    return {};
  }

  const idRecord = findRequestIdRecord(records);

  // Exit early when there is no request id
  if (!idRecord || idRecord.value.length !== idHexLength) {
    return {};
  }

  const decreaseRecord = findDecreaseRecord(records);
  const increaseRecord = findIncreaseRecord(records);
  const migrationRecord = findMigrationRecord(records);
  const typeRecord = findTypeRecord(records);

  // Exit early when there is a change in both directions
  if (!!decreaseRecord && !!increaseRecord) {
    return {};
  }

  const {channel} = chanFormat({id: channelRecord.value});
  const id = idRecord.value;
  const type = typeRecord ? hexAsNumber(typeRecord.value) : undefined;

  // Exit early when there is no decrease, increase or migration record
  if (!decreaseRecord && !increaseRecord && !migrationRecord) {
    return {request: {channel, from, id, type}};
  }

  const decrease = decodeNumber((decreaseRecord || defaultRecord).value);
  const increase = decodeNumber((increaseRecord || defaultRecord).value);

  // Exit early when there is no reasonably sized increase or decrease
  if (decrease > tooLarge || increase > tooLarge) {
    return {};
  }

  // Exit early when a migration record is present on a too-old version
  if (!!migrationRecord && !versionRecord) {
    return {};
  }

  // Exit early when a migration record is not a public key
  if (!!migrationRecord && !isPublicKey(migrationRecord.value)) {
    return {};
  }

  // Exit early when a migration record has the same key as the peer
  if (!!migrationRecord && migrationRecord.value === from) {
    return {};
  }

  return {
    request: {
      channel,
      from,
      id,
      type,
      decrease: Number(decrease) || undefined,
      increase: Number(increase) || undefined,
      to: !!migrationRecord ? migrationRecord.value : undefined,
    },
  };
};
