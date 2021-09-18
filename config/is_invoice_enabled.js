/** Determine if creating an invoice is configured

  {
    env: <Environment Variables Object>
  }

  @returns
  <Connect Service is Configured Bool>
*/
module.exports = ({env}) => {
  if (env.PAID_SERVICES_INVOICE === '1') {
    return true;
  }

  return false;
};
