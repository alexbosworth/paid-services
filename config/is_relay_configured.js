/** Determine if a relay is configured

  {
    env: <Environment Variables Object>
  }

  @returns
  <SMS Is Configured Bool>
*/
module.exports = ({env}) => {
  return env.PAID_SERVICES_RELAY === '1';
};
