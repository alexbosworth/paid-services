const idType = '0';
const capacityChangeSignatureType = '1';

/** Encode the response to a sign capacity request

  {
    id: <Capacity Change Id Hex String>
    signature: <Replacement Transaction Signature Hex String>
  }

  @returns
  {
    records: [{
      type: <Record Type Number String>
      value: <Record Value Hex Encoded String>
    }]
  }
*/
module.exports = ({id, signature}) => {
  return {
    records: [
      {
        type: idType,
        value: id,
      },
      {
        type: capacityChangeSignatureType,
        value: signature,
      },
    ],
  };
};
