const asyncAuto = require('async/auto');
const asyncReflect = require('async/reflect');
const {returnResult} = require('asyncjs-util');

const responseForActivity = require('./response_for_activity');
const responseForInbox = require('./response_for_inbox');
const responseForNetwork = require('./response_for_network');
const responseForPong = require('./response_for_pong');
const responseForProfile = require('./response_for_profile');
const responseForSchema = require('./response_for_schema');
const responseForServices = require('./response_for_services');
const {types} = require('./schema');

/** Respond to paid service request

  {
    [arguments]: <TLV Stream Arguments Hex String>
    env: <Environment Variables Object>
    fetch: <Node Fetch Function>
    id: <Invoice Id Hex String>
    lnd: <Authenticated LND API Object>
    type: <Request Type Number String>
  }

  @returns via cbk or Promise
  {
    [error]: [
      <Error Code Number>
      <Error Code Type String>
    ]
    [response]: {
      [links]: [<URL String>]
      [nodes]: [<Node Public Key Hex String>]
      [paywall]: <Paywall BOLT 11 Request String>
      [records]: [{
        type: <Record Type Number String>
        value: <Record Type Value Hex String>
      }]
      [text]: <Response Text String>
    }
  }
*/
module.exports = ({arguments, env, fetch, id, lnd, type}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([500, 'ExpectedKnownConfigurationToRespondToRequest']);
        }

        if (!fetch) {
          return cbk([500, 'ExpectedNodeFetchFunctionToRespondToRequest']);
        }

        if (!id) {
          return cbk([500, 'ExpectedInvoiceidToRespondToRequest']);
        }

        if (!lnd) {
          return cbk([500, 'ExpectedBackingLndToRespondToRequest']);
        }

        if (!type) {
          return cbk([500, 'ExpectedStandardRequestTypeToRespondToRequest']);
        }

        return cbk();
      },

      // Generate response to request
      respond: ['validate', asyncReflect(({}, cbk) => {
        switch (type) {
        case types.activity:
          return responseForActivity({env, lnd}, cbk);

        case types.inbox:
          return responseForInbox({arguments, env, fetch, id, lnd}, cbk);

        case types.ping:
          return responseForPong({}, cbk);

        case types.network:
          return responseForNetwork({env}, cbk);

        case types.profile:
          return responseForProfile({env}, cbk);

        case types.schema:
          return responseForSchema({arguments, env}, cbk);

        case types.services:
          return responseForServices({env}, cbk);

        default:
          return cbk([404, 'UnknownPaidServiceType']);
        }
      })],

      // Result of response
      result: ['respond', ({respond}, cbk) => {
        if (!!respond.error) {
          return cbk(null, {error: respond.error});
        }

        return cbk(null, {response: respond.value.response});
      }],
    },
    returnResult({reject, resolve, of: 'result'}, cbk));
  });
};
