const isEven = type => !(BigInt(type) % BigInt(2));

/** Determine if records have an unknown even record type

  An unknown even record cannot be ignored, so the records cannot be used.

  {
    known: [<Known Record Type Number String>]
    records: [{
      type: <Record Type Number String>
    }]
  }

  @returns
  {
    is_unknown_even: <Has Unknown Even Record Type Bool>
  }
*/
module.exports = ({known, records}) => {
  const isAllowed = n => known.includes(n.type) || !isEven(n.type);

  return {is_unknown_even: !records.every(isAllowed)};
};
