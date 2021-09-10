/** Determine if connecting to a node is configured

  {
    env: <Environment Variables Object>
  }

  @returns
  <Connect Service is Configured Bool>
*/
module.exports = ({env}) => {
  if (env.PAID_SERVICES_CONNECT === '1') {
    return true;
  }

  return false;
};
