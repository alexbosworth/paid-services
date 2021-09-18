const {types} = require('./schema');

const {isActivityEnabled} = require('./../config');
const {isEmailConfigured} = require('./../config');
const {isRelayConfigured} = require('./../config');
const {isSmsConfigured} = require('./../config');

const byteLength = str => Buffer.byteLength(str, 'utf8');
const enabled = '1';
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
  case types.activity:
    return {is_enabled: isActivityEnabled({env})};

  case types.connect:
    return {is_enabled: env.PAID_SERVICES_CONNECT === enabled};

  // The inbox service requires an external delivery mechanism
  case types.inbox:
    return {is_enabled: isEmailConfigured({env}) || isSmsConfigured({env})};

  case types.invoice:
    return {is_enabled: env.PAID_SERVICES_INVOICE === enabled};

  // The network service requires a list of other nodes
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

  // The relay service requires a fee rate
  case types.relay:
    return {is_enabled: isRelayConfigured({env})};

  default:
    return {is_enabled: true};
  }
};
