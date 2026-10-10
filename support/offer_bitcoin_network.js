const {parseOffer} = require('invoices');

const bitcoinChains = require('./bitcoin_chains');
const {decodeRecords} = require('./../service_records');
const {typeOfferChains} = require('./constants');

const {keys} = Object;

/** Get the Bitcoin network of an offer that is for one Bitcoin network

  An offer without `offer_chains` is for bitcoin. An offer for more than one
  chain, or for a chain that is not a Bitcoin network, has no network.

  {
    offer: <BOLT 12 Offer String>
  }

  @returns
  {
    [network]: <Bitcoin Network Name String>
  }
*/
module.exports = ({offer}) => {
  try {
    const {encoded} = parseOffer({offer});

    const {records} = decodeRecords({encoded});

    const chains = records.find(n => n.type === typeOfferChains);

    // An offer without chains is for bitcoin
    if (!chains) {
      return {network: 'bitcoin'};
    }

    const network = keys(bitcoinChains).find(chain => {
      return bitcoinChains[chain] === chains.value.toLowerCase();
    });

    // An offer for more than one chain or another chain has no network
    return !network ? {} : {network};
  } catch (err) {
    return {};
  }
};
