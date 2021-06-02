const byteLength = str => Buffer.byteLength(str, 'utf8');
const isPublicKey = n => !!n && /^[0-9A-F]{66}$/i.test(n);
const isUrl = n => {try { return !!(new URL(n)); } catch (e) { return !e; }};
const maxProfileByteLength = 400;
const nodes = env => (env.PAID_SERVICES_NETWORK_NODES || '').split(',');
const notFound = -1;
const profile = env => env.PAID_SERVICES_PROFILE_FOR_NODE || String();
const links = env => env.PAID_SERVICES_PROFILE_URLS || String();
const split = n => n.split('\n');

/** Check server configuration environment variables

  {
    env: <Environment Variables Object>
  }

  @throws
  <Error>
*/
module.exports = ({env}) => {
  if (!env) {
    throw new Error('ExpectedEnvironmentVariablesToValidateServerConfig');
  }

  if (nodes(env).filter(n=>!!n).findIndex(n => !isPublicKey(n)) !== notFound) {
    throw new Error('ExpectedCommaSeparatedListOfNetworkNodes');
  }

  if (byteLength(profile(env) + links(env)) > maxProfileByteLength) {
    throw new Error('ExpectedLessProfileDataForProfileResponse');
  }

  if (split(links(env)).filter(n=>!!n).findIndex(n => !isUrl(n)) !== notFound) {
    throw new Error('ExpectedValidProfileLinksInServerConfig');
  }

  return;
};
