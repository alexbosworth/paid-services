const {getPrices} = require('@alexbosworth/fiat');

const conversion = (fiatPrice, rate) => ((fiatPrice * 100000000) / (rate / 100)).toFixed(0);
const defaultFiatRateProvider = 'coingecko';
const isNumber = n => !isNaN(n);
const parseFiat = n => n.split('*')[1];
const parseFiatPrice = n => Number(n.split('*')[0]);
const removeSpaces = s => s.replace(/\s/g, '');

/** Converts fiat to btc

  {
    fiat_price: <Fiat Price String>
    request: <Request Function>
  }

  @returns
  {
    cost: <Price of Trade in Satoshis>
  }
*/
module.exports = async ({fiat_price, request}) => {
  if (!fiat_price) {
    throw new Error('ExpectedFiatPriceToConvertFiatToBtc');
  }

  if (!request) {
    throw new Error('ExpectedRequestFunctionToConvertFiatToBtc');
  }

  const rate = removeSpaces(fiat_price);
  const fiat = parseFiat(rate);
  const fiatPrice = parseFiatPrice(rate);
  
  // Get fiat conversion rate to use for sale
  try {
    const price = await getPrices({
      request,
      from: defaultFiatRateProvider,
      symbols: [fiat],
    });
    
    const [{rate}] = price.tickers;
    const cost = conversion(fiatPrice, rate);
    
    if (!isNumber(cost)) {
      throw new Error('ErrorConvertingFiatToSatoshisToCreateChannelSale');
    }

    return cost;
  } catch (err) {
    throw new Error(err);
  }
};

