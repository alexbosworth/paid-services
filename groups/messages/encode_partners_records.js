const typePartnersRecord = '1';

/** Encode group channel partners into records

  {
    inbound: <Inbound Channel Partner Public Key Hex String>
    outbound: <Outbound Channel Partner Public Key Hex String>
  }

  @returns
  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }
*/
module.exports = ({inbound, outbound}) => {
  return {records: [{type: typePartnersRecord, value: inbound + outbound}]};
};
