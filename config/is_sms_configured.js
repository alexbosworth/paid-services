/** Determine if sending SMS is configured

  {
    env: <Environment Variables Object>
  }

  @returns
  <SMS Is Configured Bool>
*/
module.exports = ({env}) => {
  if (!env.PAID_SERVICES_INBOX_SMS_FROM_NUMBER) {
    return false;
  }

  if (!env.PAID_SERVICES_INBOX_SMS_TO_NUMBER) {
    return false;
  }

  if (!env.PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID) {
    return false;
  }

  if (!env.PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN) {
    return false;
  }

  return true;
};
