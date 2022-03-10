const {parsePaymentRequest} = require('ln-service');

const defaultNetwork = 'bitcoin';
const regtestNetwork = 'regtest';
const regtestNetworkType = '02';
const testnetNetwork = 'testnet';
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

  try {
    const {network} = parsePaymentRequest({request});

    if (network === defaultNetwork) {
      return {};
    }
  
    if (network === regtestNetwork) {
      return {value: regtestNetworkType};
    }
  
    if (network === testnetNetwork) {
      return {value: testnetNetworkType};
    }
  
    throw new Error('UnknownNetworkToDeriveNetworkRecordFor');

  } catch (err) {
    throw new Error('FailedToParsePaymentRequestToDeriveNetworkRecord');
  }

};
