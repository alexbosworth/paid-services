const defaultNetwork = 'btc';
const regtestNetwork = 'btcregtest';
const regtestNetworkType = '02';
const testnetNetwork = 'btctestnet';
const testnetNetworkType = '01';

/** Derive a network record name from a network name

  {
    network: <Network Name String>
  }

  @returns
  {
    [value]: <Network Record Value Hex String>
  }
*/
module.exports = ({network}) => {
  if (!network) {
    throw new Error('ExpectedNetworkNameToDeriveNetworkRecord');
  }

  switch (network) {
  case defaultNetwork:
    return {};

  case regtestNetwork:
    return {value: regestNetworkType};

  case testnetNetwork:
    return {value: testnetNetworkType};

  default:
    throw new Error('UnknownNetworkNameToDeriveNetworkRecordFor');
  }
};
