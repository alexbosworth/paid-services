/** Determine if sharing routing activity is configured

  {
    env: <Environment Variables Object>
  }

  @returns
  <Routing Activity is Configured Bool>
*/
module.exports = ({env}) => {
  if (env.PAID_SERVICES_ACTIVITY_FEES === '1') {
    return true;
  }

  if (env.PAID_SERVICES_ACTIVITY_VOLUME === '1') {
    return true;
  }

  return false;
};
