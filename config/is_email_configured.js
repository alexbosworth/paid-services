/** Determine if sending email is configured

  {
    env: <Environment Variables Object>
  }

  @returns
  <Email Is Configured Bool>
*/
module.exports = ({env}) => {
  if (!env.PAID_SERVICES_INBOX_EMAIL_FROM) {
    return false;
  }

  if (!env.PAID_SERVICES_INBOX_EMAIL_TO) {
    return false;
  }

  if (!env.PAID_SERVICES_INBOX_POSTMARK_API_KEY) {
    return false;
  }

  return true;
};
