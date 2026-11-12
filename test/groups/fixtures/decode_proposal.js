/** Decode a proposal and summarize parse errors

  {
    method: <Proposal Decoder Function>
    proposal: {
      records: [<Peer Request Record Object>]
    }
  }

  @returns
  <Decoded Proposal Object Or Error Summary Object>
*/
module.exports = args => {
  try {
    return args.method(args.proposal);
  } catch (err) {
    return {error: err.message};
  }
};
