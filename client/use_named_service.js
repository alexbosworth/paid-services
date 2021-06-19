const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const argumentsForSchema = require('./arguments_for_schema');
const confirmServiceUse = require('./confirm_service_use');
const makeServiceRequest = require('./make_service_request');

const schemaServiceId = '0';

/** Use a named service

  {
    ask: <Ask Function>
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    named: <Service Name String>
    node: <Node Public Key Hex String>
  }

  @returns via cbk or Promise
  {
    [links]: [<URL String>]
    [paywall]: <BOLT 11 Payment Request String>
    [nodes]: [<Node Public Key Hex String>]
    [records]: [{
      type: <Type Number String>
      value: <Value Hex String>
    }]
    [text]: <Response Message String>
  }
*/
module.exports = ({ask, lnd, network, named, node}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedAskFunctionToUseNamedService']);
        }

        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToUseNamedService']);
        }

        if (!named) {
          return cbk([400, 'ExpectedNameOfServiceToUse']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToUseNamedService']);
        }

        if (!node) {
          return cbk([400, 'ExpectedNodePublicKeyToUseNamedService']);
        }

        return cbk();
      },

      // Get the schema for the named service
      getSchema: ['validate', ({}, cbk) => {
        return makeServiceRequest({
          lnd,
          network,
          node,
          arguments: argumentsForSchema({named}).arguments,
          id: schemaServiceId,
        },
        cbk);
      }],

      // Interrogate for schema-required data
      getFields: ['getSchema', ({getSchema}, cbk) => {
        return confirmServiceUse({ask, records: getSchema.records}, cbk);
      }],

      // Submit the service request with the arguments attached
      send: ['getFields', 'getSchema', ({getFields, getSchema}, cbk) => {
        return makeServiceRequest({
          lnd,
          network,
          node,
          arguments: getFields.arguments,
          id: getSchema.id,
        },
        cbk);
      }],
    },
    returnResult({reject, resolve, of: 'send'}, cbk));
  });
};
