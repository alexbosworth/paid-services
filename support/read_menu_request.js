const tlvStreamRecords = require('./tlv_stream_records');
const {truncatedAsNumber} = require('./../service_records');
const {typeMenuRequestPage} = require('./constants');

const isEven = type => !(BigInt(type) % BigInt(2));
const isKnown = n => knownOptions.includes(n.type);
const {isSafeInteger} = Number;
const isUnknownEven = n => !isKnown(n) && isEven(n.type);
const knownOptions = [typeMenuRequestPage];

/** Read the options of a menu request record: the page number, zero when it
  is left out

  A record that is not a valid TLV stream, that has an unknown even option,
  or whose page number cannot be read has no page.

  {
    encoded: <Menu Request Record Value Hex String>
  }

  @returns
  {
    [page]: <Menu Page Number Number>
  }
*/
module.exports = ({encoded}) => {
  const {records} = tlvStreamRecords({encoded});

  // Exit early when the options are not a valid TLV stream
  if (!records) {
    return {};
  }

  // Exit early when there is an option that has to be understood but is not
  if (!!records.filter(isUnknownEven).length) {
    return {};
  }

  const pageOption = records.find(n => n.type === typeMenuRequestPage);

  // A page number that is left out is the first page
  if (!pageOption) {
    return {page: Number()};
  }

  try {
    const page = Number(truncatedAsNumber({encoded: pageOption.value}).number);

    return isSafeInteger(page) ? {page} : {};
  } catch (err) {
    return {};
  }
};
