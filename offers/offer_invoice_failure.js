/** Select the error to return when no offer path gave back an invoice

  A reply that was not a good invoice says more about why there is no invoice
  than no reply. When there was no reply at all, the failure of each path is
  given.

  {
    failures: [{
      err: [<Error Code Number>, <Error Message String>, <Details Object>]
      [is_reply]: <Recipient Replied Bool>
    }]
  }

  @returns
  {
    error: [<Error Code Number>, <Error Message String>, <Details Object>]
  }
*/
module.exports = ({failures}) => {
  const [reply] = failures.filter(n => n.is_reply).reverse();

  // Exit early when the recipient replied without a good invoice
  if (!!reply) {
    return {error: reply.err};
  }

  return {
    error: [503, 'FailedToGetInvoiceForOffer', {
      failures: failures.map(n => n.err),
    }],
  };
};
