const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const isServiceEnabled = require('./is_service_enabled');
const {types} = require('./schema');

const text = env => env.PAID_SERVICES_PROFILE_FOR_NODE;
const urls = env => (env.PAID_SERVICES_PROFILE_URLS || '').split('\n');

/** Derive a node details response from a request

  {
    env: <Environment Variables Object>
  }

  @returns
  {
    response: {
      links: [<URL String>]
      text: <Response Text String>
    }
  }
*/
module.exports = ({env}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ServerConfMissingForNodeProfileResponse']);
        }

        if (!isServiceEnabled({env, id: types.profile}).is_enabled) {
          return cbk([404, 'ServiceCurrentlyUnsupported']);
        }

        return cbk();
      },

      // Return the node profile
      respond: ['validate', ({}, cbk) => {
        const links = urls(env).filter(n => !!n);

        // Exit early when there are no links
        if (!links.length) {
          return cbk(null, {response: {text: text(env)}});
        }

        return cbk(null, {response: {links, text: text(env)}});
      }],
    },
    returnResult({reject, resolve, of: 'respond'}, cbk));
  });
};