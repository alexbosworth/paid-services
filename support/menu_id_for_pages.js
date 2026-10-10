const {createHash} = require('node:crypto');

const encodeMenuEntry = require('./encode_menu_entry');
const {listAsHex} = require('./../service_records');
const {menuIdBytes} = require('./constants');

const {isArray} = Array;
const hexLength = bytes => bytes * 2;
const sha256 = hex => createHash('sha256').update(Buffer.from(hex, 'hex'));

/** Make the menu id of a menu from the encoded entries on each of its pages,
  so that the same pages have the same id, like when they are signed again

  {
    pages: [[{
      [bip353_name]: <Offer BIP 353 Human Readable Name String>
      [is_without_paths]: <Offer Is Reached Over Support Offer Paths Bool>
      [issuer_id]: <Offer Issuer Id Public Key Hex String>
      [offer]: <BOLT 12 Offer String>
      [service_id]: <Support Offer Service Id Hex String>
      [service_sequence]: <Lowest Support Offer Service Sequence String>
    }]]
  }

  @throws
  <Error>

  @returns
  {
    menu_id: <Menu Id Hex String>
  }
*/
module.exports = ({pages}) => {
  if (!isArray(pages) || !pages.every(isArray)) {
    throw new Error('ExpectedPagesOfEntriesToMakeMenuId');
  }

  const items = pages.map(entries => {
    const encoded = entries.map(entry => encodeMenuEntry(entry).encoded);

    return listAsHex({items: encoded}).encoded;
  });

  const {encoded} = listAsHex({items});

  const hash = sha256(encoded).digest('hex');

  return {menu_id: hash.slice(Number(), hexLength(menuIdBytes))};
};
