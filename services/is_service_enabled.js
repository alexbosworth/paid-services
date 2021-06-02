const {types} = require('./schema');

const {isEmailConfigured} = require('./../config');
const {isSmsConfigured} = require('./../config');

const byteLength = str => Buffer.byteLength(str, 'utf8');
const maxProfileLength = 400;

/** Determine if a service is enabled

  {
    env: <Environment Variables Object>
    id: <Service Id Number String>
  }

  @returns
  {
    is_enabled: <Service is Enabled Bool>
  }
*/
module.exports = ({env, id}) => {
  switch (id) {
  // The inbox service requires an external delivery mechanism
  case types.inbox:
    return {is_enabled: isEmailConfigured({env}) || isSmsConfigured({env})};

  case types.network:
    return {is_enabled: !!env.PAID_SERVICES_NETWORK_NODES};

  // The profile service requires a profile
  case types.profile:
    const profile = env.PAID_SERVICES_PROFILE_FOR_NODE || String();
    const urls = env.PAID_SERVICES_PROFILE_URLS || String();

    if (!profile && !urls) {
      return {is_enabled: false};
    }

    if (byteLength(profile + urls) > maxProfileLength) {
      return {is_enabled: false};
    }

    return {is_enabled: true};

  default:
    return {is_enabled: true};
  }
};
