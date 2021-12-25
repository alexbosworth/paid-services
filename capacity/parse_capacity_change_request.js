const {chanFormat} = require('bolt07');
const {decodeBigSize} = require('bolt01');

const channelIdHexLength = 16;
const decodeNumber = encoded => BigInt(decodeBigSize({encoded}).decoded);
const defaultRecord = {value: '00'};
const idHexLength = 64;
const tooLarge = BigInt(Number.MAX_SAFE_INTEGER);

const findChannelRecord = records => records.find(n => n.type === '2');
const findDecreaseRecord = records => records.find(n => n.type === '3');
const findIncreaseRecord = records => records.find(n => n.type === '4');
const findRequestIdRecord = records => records.find(n => n.type === '1');
const findVersionRecord = records => records.find(n => n.type === '0');

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
    }
  }
*/
module.exports = ({from, records}) => {
  // Exit early when there are no records
  if (!records) {
    return {};
  }

  // Exit early when there is a version record, indicating a future version
  if (!!findVersionRecord(records)) {
    return {};
  }

  const channelRecord = findChannelRecord(records);

  // Exit early when there is no channel
  if (!channelRecord || channelRecord.value.length !== channelIdHexLength) {
    return {};
  }

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

  // Exit early when there is a change in both directions
  if (!!decreaseRecord && !!increaseRecord) {
    return {};
  }

  const {channel} = chanFormat({id: channelRecord.value});
  const id = idRecord.value;

  // Exit early when there is no decrease or increase
  if (!decreaseRecord && !increaseRecord) {
    return {request: {channel, from, id}};
  }

  const decrease = decodeNumber((decreaseRecord || defaultRecord).value);
  const increase = decodeNumber((increaseRecord || defaultRecord).value);

  // Exit early when there is no reasonably sized increase or decrease
  if (decrease > tooLarge || increase > tooLarge) {
    return {};
  }

  return {
    request: {
      channel,
      from,
      id,
      decrease: Number(decrease) || undefined,
      increase: Number(increase) || undefined,
    },
  };
};
