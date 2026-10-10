const bufferAsHex = buffer => buffer.toString('hex');
const directionLesser = '0';
const edgeDirection = edge => edge.split('x').slice(-1).join('');
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const policiesCount = 2;

/** Determine the introduction node of a blinded path

  When the introduction is an edge, the channel for that edge is needed

  {
    [channel]: {
      policies: [{
        public_key: <Channel Node Public Key Hex String>
      }]
    }
    path: {
      [introduction_edge]: <Introduction Node Edge Format Channel Id String>
      [introduction_node]: <Introduction Node Public Key Hex String>
    }
  }

  @throws
  <Error>

  @returns
  {
    introduction: <Introduction Node Public Key Hex String>
  }
*/
module.exports = ({channel, path}) => {
  if (!path) {
    throw new Error('ExpectedBlindedPathToDeterminePathIntroduction');
  }

  if (!path.introduction_edge && !path.introduction_node) {
    throw new Error('ExpectedPathIntroductionToDeterminePathIntroduction');
  }

  // Exit early when the introduction node is directly specified
  if (!!path.introduction_node) {
    return {introduction: path.introduction_node};
  }

  if (!channel || !isArray(channel.policies)) {
    throw new Error('ExpectedChannelForPathIntroductionEdge');
  }

  const keys = channel.policies.map(n => n.public_key);

  if (keys.length !== policiesCount || !keys.every(n => !!n)) {
    throw new Error('ExpectedChannelPoliciesForPathIntroductionEdge');
  }

  // Direction 0 is the lesser node key and 1 is the greater node key
  const [lesser, greater] = keys
    .map(hexAsBuffer)
    .sort(Buffer.compare)
    .map(bufferAsHex);

  const isLesser = edgeDirection(path.introduction_edge) === directionLesser;

  return {introduction: isLesser ? lesser : greater};
};
