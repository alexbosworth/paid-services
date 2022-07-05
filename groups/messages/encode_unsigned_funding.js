const typeUnsignedFundingPsbt = '1';

/** Encode unsigned funding transaction records

  {
    psbt: <Unsigned Funding PSBT Hex String>
  }

  @returns
  {
    records: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
  }
*/
module.exports = ({psbt}) => {
  return {records: [{type: typeUnsignedFundingPsbt, value: psbt}]};
};
