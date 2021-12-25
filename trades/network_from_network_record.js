const defaultNetwork = 'bitcoin';
const regtestNetwork = 'regtest';
const regtestNetworkType = '02';
const testnetNetwork = 'testnet';
const testnetNetworkType = '01';

/** Derive a network name from a network record

  {
    [value]: <Network Value Hex String>
  }

  @returns
  {
    network: <BitcoinJs Network Name String>
  }
*/
module.exports = ({value}) => {
  if (!value) {
    return defaultNetwork;
  }

  if (value === regtestNetworkType) {
    return regtestNetwork;
  }

  if (value === testnetNetworkType) {
    return testnetNetwork;
  }

  throw new Error('UnknownNetworkType');
};
