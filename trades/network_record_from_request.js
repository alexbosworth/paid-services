const defaultNetwork = 'lnbc';
const testnetNetwork = 'lntb';
const testnetNetworkType = '01';

/** Derive a network record name from a payment request

  {
    request: <Network Value Hex String>
  }

  @returns
  {
    [value]: <Network Record Value Hex String>
  }
*/
module.exports = ({request}) => {
  if (!request) {
    throw new Error('ExpectedPaymentRequestToDeriveNetworkRecord');
  }

  if (request.startsWith(defaultNetwork)) {
    return {};
  }

  if (request.startsWith(testnetNetwork)) {
    return {value: testnetNetworkType};
  }

  throw new Error('UnknownNetworkToDeriveNetworkRecordFor');
};
