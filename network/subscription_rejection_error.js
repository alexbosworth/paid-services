const {accessDeniedMessages} = require('./constants');
const {codeInvalidArgument} = require('./constants');
const {codePermissionDenied} = require('./constants');
const {codeUnauthenticated} = require('./constants');
const {codeUnimplemented} = require('./constants');

const accessDeniedCodes = [codePermissionDenied, codeUnauthenticated];
const deniedMessages = accessDeniedMessages.map(n => new RegExp(n));
const rejectionCodes = [codeInvalidArgument, codeUnimplemented];

/** Derive the error for a messages subscription that LND rejected

  A rejected subscription is not recovered by subscribing again. This is
  judged the way that the invoices subscription of ln-service judges it.

  {
    [err]: {
      [code]: <gRPC Status Code Number>
      [details]: <gRPC Status Details String>
    }
  }

  @returns
  {
    [error]: <Subscription Rejected Error Array>
  }
*/
module.exports = ({err}) => {
  // Exit early when there is no error to derive a rejection from
  if (!err) {
    return {};
  }

  // LND denies access with a gRPC status code, or with a message about a
  // missing, unreadable, expired, locked, or insufficiently permissioned
  // macaroon
  const isDeniedCode = accessDeniedCodes.includes(err.code);
  const isDeniedMessage = deniedMessages.some(n => n.test(err.details));

  if (isDeniedCode || isDeniedMessage) {
    return {error: [403, 'PermissionDeniedToSubscribeToMessages', {err}]};
  }

  if (rejectionCodes.includes(err.code)) {
    return {error: [503, 'SubscriptionToMessagesRejected', {err}]};
  }

  return {};
};
