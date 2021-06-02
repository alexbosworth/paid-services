const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const {types} = require('./schema');

const isPublicKey = n => !!n && /^[0-9A-F]{66}$/i.test(n);
const keys = env => (env.PAID_SERVICES_NETWORK_NODES || '').split(',');

/** Derive a node details response from a request

  {
    env: <Environment Variables Object>
  }

  @returns
  {
    response: {
      nodes: [<Public Key Hex String>]
    }
  }
*/
module.exports = ({env}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ServerConfMissingForNodeNetworkResponse']);
        }

        if (!keys(env).filter(n => !!n).length) {
          return cbk([404, 'ServiceCurrentlyUnsupported']);
        }

        if (!!keys(env).filter(n => !!n).filter(n => !isPublicKey(n)).length) {
          return cbk([500, 'InvalidNetworkNodesConfiguration']);
        }

        return cbk();
      },

      // Return the node network
      respond: ['validate', ({}, cbk) => {
        return cbk(null, {response: {nodes: keys(env).filter(n => !!n)}});
      }],
    },
    returnResult({reject, resolve, of: 'respond'}, cbk));
  });
};